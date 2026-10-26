import { appendFile, mkdir, open, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { createReadStream, open as openStream, close as closeStream, read as readStream, type ReadStream } from 'node:fs';
import { dirname } from 'node:path';
import { Data, Effect, Schema } from 'effect';
import type { Row } from './rolloutMeta.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

export class RolloutUnreadable extends Data.TaggedError('RolloutUnreadable')<{
  readonly reason: 'io' | 'meta-missing' | 'meta-json' | 'item-json';
  readonly path: string;
  readonly message: string;
}> {}

export type RolloutRecord = {
  readonly kind?: string;
  readonly row?: { readonly [key: string]: unknown };
  readonly thread?: unknown;
  readonly meta?: unknown;
};

const holdsRecord = Schema.is(
  Schema.Struct({
    kind: Schema.optional(Schema.String),
    row: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    thread: Schema.optional(Schema.Unknown),
    meta: Schema.optional(Schema.Unknown),
  }),
);

export const readsAsRecord = (value: unknown): value is RolloutRecord => holdsRecord(value);

export type RolloutEvent = {
  readonly position: number;
  readonly id: string;
  readonly kind: string;
  readonly payload: { readonly [key: string]: unknown };
  readonly [key: string]: unknown;
};

const holdsEvent = Schema.is(
  Schema.Struct({
    position: Schema.Number,
    id: Schema.String,
    kind: Schema.String,
    payload: Schema.Record(Schema.String, Schema.Unknown),
  }),
);

const readsAsEvent = (value: unknown): value is RolloutEvent => holdsEvent(value);

export const rolloutEventOf = (record: RolloutRecord): RolloutEvent | null =>
  record.kind === 'event' && readsAsEvent(record.row) ? record.row : null;

export type RolloutRecordVerdict =
  | { readonly kind: 'carried'; readonly record: 'event'; readonly row: Row; readonly position: number }
  | {
      readonly kind: 'carried';
      readonly record: 'checkpoint' | 'pruned' | 'pruned-retired';
      readonly row: Row;
    }
  | { readonly kind: 'read-past' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function recordVerdict(record: RolloutRecord): RolloutRecordVerdict {
  if (record.kind === 'meta') return { kind: 'read-past' };
  if (record.kind === undefined || record.row === undefined) {
    return {
      kind: 'unreadable',
      reason: `a record carries no kind: ${JSON.stringify(record).slice(0, 120)}`,
    };
  }
  if (record.kind === 'hold') return { kind: 'read-past' };
  if (record.kind === 'event') {
    const event = rolloutEventOf(record);
    return event === null
      ? { kind: 'unreadable', reason: `an event record carries no position, id, kind and payload: ${JSON.stringify(record).slice(0, 120)}` }
      : { kind: 'carried', record: 'event', row: event, position: event.position };
  }
  if (record.kind === 'checkpoint' || record.kind === 'pruned' || record.kind === 'pruned-retired') {
    return { kind: 'carried', record: record.kind, row: record.row };
  }
  return { kind: 'unreadable', reason: `an unknown record kind: ${record.kind}` };
}

export async function* wholeLinesOf(chunks: AsyncIterable<Buffer>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let parts: Buffer[] = [];
  for await (const chunk of chunks) {
    let from = 0;
    for (let newline = chunk.indexOf(0x0a); newline !== -1; newline = chunk.indexOf(0x0a, from)) {
      parts.push(chunk.subarray(from, newline));
      yield decoder.decode(parts.length === 1 ? parts[0] : Buffer.concat(parts));
      parts = [];
      from = newline + 1;
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
  }
}

export function readRolloutLine(line: string): { readonly record: RolloutRecord } | { readonly failure: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    return { failure: `is not JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  return readsAsRecord(value) ? { record: value } : { failure: 'is not a rollout record' };
}

export type Rollout = {
  readonly meta: unknown;
  readonly items: readonly RolloutRecord[];
  readonly torn: boolean;
  readonly bytes: number;
};

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const ioFailure = (path: string, error: unknown): RolloutUnreadable =>
  new RolloutUnreadable({ reason: 'io', path, message: error instanceof Error ? error.message : String(error) });

export const ROLLOUT_BLOCK = 64 * 1024;

export type ReadRange = { readonly start: number; readonly end: number };

export function rolloutStream(path: string, observe: ReadRollout, handle?: FileHandle, range?: ReadRange): ReadStream {
  return createReadStream(path, {
    ...range,
    fd: handle?.fd,
    fs: {
      open: openStream,
      close: (fd, done) => (handle === undefined ? closeStream(fd, done) : void handle.close().then(() => done(null), done)),
      read: (fd, buffer, offset, length, position, done) => {
        readStream(fd, buffer, offset, length, position, (error, bytes, read) => {
          if (error === null) observe({ path, bytes });
          done(error, bytes, read);
        });
      },
    },
  });
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function createRollout(path: string, meta: unknown): Effect.Effect<void, RolloutUnreadable> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, line(meta), { flag: 'wx' });
    },
    catch: (error) => ioFailure(path, error),
  });
}

export async function cutTornTail(path: string, read: ReadRollout): Promise<void> {
  const size = await fileSize(path);
  if (size === null || size === 0) return;
  const handle = await open(path, 'r+');
  try {
    const last = Buffer.alloc(1);
    const tail = await handle.read(last, 0, 1, size - 1);
    read({ path, bytes: tail.bytesRead });
    if (last[0] === 0x0a) return;
    let end = size - 1;
    let cut = 0;
    const chunk = Buffer.alloc(4096);
    scan: while (end > 0) {
      const start = Math.max(0, end - chunk.length);
      const { bytesRead } = await handle.read(chunk, 0, end - start, start);
      read({ path, bytes: bytesRead });
      for (let i = bytesRead - 1; i >= 0; i -= 1) {
        if (chunk[i] === 0x0a) {
          cut = start + i + 1;
          break scan;
        }
      }
      end = start;
    }
    await handle.truncate(cut);
  } finally {
    await handle.close();
  }
}

export function appendRolloutItem(path: string, item: unknown): Effect.Effect<void, RolloutUnreadable> {
  return Effect.flatMap(RolloutReads, (read) =>
    Effect.tryPromise({
      try: async () => {
        await cutTornTail(path, read);
        await appendFile(path, line(item));
      },
      catch: (error) => ioFailure(path, error),
    }),
  );
}

const APPEND_CHUNK = 16 * ROLLOUT_BLOCK;

export function appendRolloutItems(path: string, items: Iterable<unknown>): Effect.Effect<number, RolloutUnreadable> {
  return Effect.flatMap(RolloutReads, (read) =>
    Effect.tryPromise({
      try: async () => {
        await cutTornTail(path, read);
        const handle = await open(path, 'a');
        let written = 0;
        try {
          let pending: string[] = [];
          let size = 0;
          for (const item of items) {
            const text = line(item);
            pending.push(text);
            size += text.length;
            written += 1;
            if (size < APPEND_CHUNK) continue;
            await handle.appendFile(pending.join(''));
            pending = [];
            size = 0;
          }
          if (pending.length > 0) await handle.appendFile(pending.join(''));
        } finally {
          await handle.close();
        }
        return written;
      },
      catch: (error) => ioFailure(path, error),
    }),
  );
}

export type RolloutScan = Omit<Rollout, 'items'>;

class RolloutLineFailed extends Data.TaggedError('RolloutLineFailed')<{
  readonly reason: 'meta-json' | 'item-json';
  readonly message: string;
}> {
  constructor(reason: 'meta-json' | 'item-json', cause: unknown) {
    super({ reason, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function scanRollout(path: string, visit: (item: RolloutRecord) => void): Effect.Effect<RolloutScan, RolloutUnreadable> {
  return Effect.flatMap(RolloutReads, (read) =>
    Effect.tryPromise({
      try: async () => {
        const size = (await stat(path)).size;
        let meta: { readonly value: unknown } | null = null;
        let bytes = 0;
        for await (const { line, end } of wholeLinesAfter(path, 0, read)) {
          bytes = end;
          if (line === '') continue;
          const reason = meta === null ? 'meta-json' : 'item-json';
          let value: unknown;
          try {
            value = JSON.parse(line) as unknown;
          } catch (cause) {
            throw new RolloutLineFailed(reason, cause);
          }
          if (meta === null) meta = { value };
          else if (readsAsRecord(value)) visit(value);
          else throw new RolloutLineFailed('item-json', new Error('the line is not a rollout record'));
        }
        return { meta, torn: bytes < size, bytes };
      },
      catch: (error) =>
        error instanceof RolloutLineFailed
          ? new RolloutUnreadable({ reason: error.reason, path, message: error.message })
          : ioFailure(path, error),
    }).pipe(
      Effect.flatMap(({ meta, torn, bytes }) =>
        meta === null
          ? Effect.fail(new RolloutUnreadable({ reason: 'meta-missing', path, message: 'the rollout has no meta line' }))
          : Effect.succeed({ meta: meta.value, torn, bytes }),
      ),
    ),
  );
}

export function replayRollout(path: string): Effect.Effect<Rollout, RolloutUnreadable> {
  const items: RolloutRecord[] = [];
  return Effect.map(
    scanRollout(path, (item) => items.push(item)),
    (scan) => ({ ...scan, items }),
  );
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

const blockAt = async (handle: FileHandle, path: string, from: number, length: number, read: ReadRollout): Promise<Buffer> => {
  const block = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(block, filled, length - filled, from + filled);
    read({ path, bytes: bytesRead });
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  return filled === length ? block : block.subarray(0, filled);
};

const joined = (parts: readonly Buffer[]): Buffer => (parts.length === 1 ? parts[0]! : Buffer.concat(parts));

export async function* wholeLinesAfter(
  path: string,
  offset: number,
  read: ReadRollout,
): AsyncGenerator<{ readonly line: string; readonly end: number }> {
  const size = (await stat(path)).size;
  if (size <= offset) return;
  const handle = await open(path, 'r');
  try {
    let at = offset;
    let parts: Buffer[] = [];
    while (at < size) {
      const block = await blockAt(handle, path, at, Math.min(ROLLOUT_BLOCK, size - at), read);
      if (block.length === 0) break;
      let from = 0;
      for (let newline = block.indexOf(0x0a); newline !== -1; newline = block.indexOf(0x0a, from)) {
        parts.push(block.subarray(from, newline));
        yield { line: decoder.decode(joined(parts)), end: at + newline + 1 };
        parts = [];
        from = newline + 1;
      }
      if (from < block.length) parts.push(block.subarray(from));
      at += block.length;
    }
  } finally {
    await handle.close();
  }
}

export async function* wholeLinesBefore(
  path: string,
  before: number,
  read: ReadRollout,
): AsyncGenerator<{ readonly line: string; readonly start: number }> {
  const size = (await stat(path)).size;
  let at = Math.min(before, size);
  if (at <= 0) return;
  const handle = await open(path, 'r');
  try {
    let later: Buffer[] = [];
    let closed = false;
    while (at > 0) {
      const from = Math.max(0, at - ROLLOUT_BLOCK);
      const block = await blockAt(handle, path, from, at - from, read);
      if (block.length < at - from) return;
      let upto = block.length;
      for (let newline = block.lastIndexOf(0x0a, upto - 1); newline !== -1; newline = upto > 0 ? block.lastIndexOf(0x0a, upto - 1) : -1) {
        if (closed) {
          later.push(block.subarray(newline + 1, upto));
          const bytes = joined(later.reverse());
          if (bytes.length > 0) yield { line: decoder.decode(bytes), start: from + newline + 1 };
        }
        later = [];
        closed = true;
        upto = newline;
      }
      if (closed && upto > 0) later.push(block.subarray(0, upto));
      at = from;
    }
    if (closed) {
      const bytes = joined(later.reverse());
      if (bytes.length > 0) yield { line: decoder.decode(bytes), start: 0 };
    }
  } finally {
    await handle.close();
  }
}

export async function lineStartFrom(path: string, offset: number, read: ReadRollout): Promise<number> {
  if (offset <= 0) return 0;
  const size = (await stat(path)).size;
  if (offset >= size) return size;
  const handle = await open(path, 'r');
  try {
    for (let at = offset - 1; at < size; at += ROLLOUT_BLOCK) {
      const block = await blockAt(handle, path, at, Math.min(ROLLOUT_BLOCK, size - at), read);
      if (block.length === 0) break;
      const newline = block.indexOf(0x0a);
      if (newline !== -1) return at + newline + 1;
    }
    return size;
  } finally {
    await handle.close();
  }
}

export const eachLineAfter = <E, R>(
  path: string,
  offset: number,
  visit: (entry: { readonly line: string; readonly end: number }) => Effect.Effect<boolean | void, E, R>,
): Effect.Effect<void, E | RolloutUnreadable, R> =>
  Effect.flatMap(RolloutReads, (read) => {
    const source = wholeLinesAfter(path, offset, read);
    return Effect.gen(function* () {
      for (;;) {
        const next = yield* Effect.tryPromise({ try: () => source.next(), catch: (error) => ioFailure(path, error) });
        if (next.done) return;
        if ((yield* visit(next.value)) === true) return;
      }
    }).pipe(Effect.ensuring(Effect.promise(() => source.return(undefined))));
  });
