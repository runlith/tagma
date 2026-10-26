import { constants } from 'node:fs';
import { link, mkdir, open, readdir, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Context, Data, Effect } from 'effect';
import type { ThreadEventRow } from '@runlith/agent/thread/storage/eventLog';
import { ROLLOUT_BLOCK, cutTornTail, fileSize } from './rolloutFile.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { RolloutMeta, Row } from './rolloutMeta.js';
import { compressedRollout } from './rolloutForms.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

export type RolloutBirth = (
  threadId: string,
  unit: Unit<'machine'>,
) => Effect.Effect<
  {
    readonly meta: RolloutMeta;
    readonly holds: readonly Row[];
  },
  RolloutWriterFailed
>;

export class RolloutWriterFailed extends Data.TaggedError('RolloutWriterFailed')<{
  readonly reason: 'io' | 'not-a-rollout' | 'ahead';
  readonly threadId: string;
  readonly message: string;
}> {}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

async function appendExisting(path: string, text: string): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_APPEND);
  try {
    await file.writeFile(text);
  } finally {
    await file.close();
  }
}

type FloorTail = {
  readonly position: number;
  readonly meta: boolean;
};

type Head = { position: number };

async function readAt(handle: FileHandle, path: string, offset: number, length: number, observe: ReadRollout): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
    observe({ path, bytes: bytesRead });
    if (bytesRead <= 0) break;
    filled += bytesRead;
  }
  return filled === length ? buffer : buffer.subarray(0, filled);
}

async function newlineBefore(handle: FileHandle, path: string, before: number, observe: ReadRollout): Promise<number> {
  let end = before;
  while (end > 0) {
    const start = Math.max(0, end - ROLLOUT_BLOCK);
    const block = await readAt(handle, path, start, end - start, observe);
    for (let index = block.length - 1; index >= 0; index -= 1) {
      if (block[index] === 0x0a) return start + index;
    }
    end = start;
  }
  return -1;
}

async function lastEventPosition(handle: FileHandle, path: string, size: number, observe: ReadRollout): Promise<number> {
  const terminated = (await readAt(handle, path, size - 1, 1, observe))[0] === 0x0a;
  let end = terminated ? size - 1 : size;
  let torn = !terminated;
  while (end > 0) {
    const newline = await newlineBefore(handle, path, end, observe);
    const start = newline + 1;
    const row = (await readAt(handle, path, start, end - start, observe)).toString('utf8');
    const read = eventPositionOf(row);
    if (read === UNREADABLE && !torn) {
      throw new Error(`the rollout holds an unreadable record at byte ${start}`);
    }
    if (typeof read === 'number') return read;
    torn = false;
    if (newline < 0) return 0;
    end = newline;
  }
  return 0;
}

const UNREADABLE = Symbol('unreadable');

function eventPositionOf(row: string): number | null | typeof UNREADABLE {
  if (row === '') return null;
  let record: { kind?: string; row?: { position?: unknown } };
  try {
    record = JSON.parse(row) as typeof record;
  } catch {
    return UNREADABLE;
  }
  if (record.kind !== 'event') return null;
  const at = record.row?.position;
  return typeof at === 'number' ? at : UNREADABLE;
}

async function firstLine(handle: FileHandle, path: string, size: number, observe: ReadRollout): Promise<string> {
  let end = 0;
  while (end < size) {
    const block = await readAt(handle, path, end, Math.min(ROLLOUT_BLOCK, size - end), observe);
    if (block.length === 0) break;
    const newline = block.indexOf(0x0a);
    if (newline >= 0) return (await readAt(handle, path, 0, end + newline, observe)).toString('utf8');
    end += block.length;
  }
  return (await readAt(handle, path, 0, end, observe)).toString('utf8');
}

export async function tailOfRollout(path: string, observe: ReadRollout): Promise<FloorTail> {
  const size = await fileSize(path);
  if (size === null || size === 0) return { position: 0, meta: false };
  const handle = await open(path, 'r');
  try {
    return {
      position: await lastEventPosition(handle, path, size, observe),
      meta: isMetaLine(await firstLine(handle, path, size, observe)),
    };
  } finally {
    await handle.close();
  }
}

function isMetaLine(row: string): boolean {
  if (row === '') return false;
  try {
    const record = JSON.parse(row) as { thread?: unknown; record?: unknown };
    return record.record != null || record.thread != null;
  } catch {
    return false;
  }
}

export type PendingRollout = { readonly threadId: string; readonly path: string };

export type RolloutWriter = ReturnType<typeof rolloutWriter>;

export const rolloutWriter = ({
  pathOf,
  birth,
  pendingDir,
}: {
  readonly pathOf: (projectId: number, threadId: string) => string | undefined;
  readonly birth: RolloutBirth | null;
  readonly pendingDir: string | undefined;
}) => {
  const marked = new Set<string>();
  const clean = new Set<string>();
  const heads = new Map<string, Head>();
  const paths = new Map<string, string | null>();
  const refused = new Map<string, RolloutWriterFailed>();

  const markPending = async (threadId: string, path: string): Promise<void> => {
    if (pendingDir === undefined || marked.has(threadId)) return;
    await mkdir(pendingDir, { recursive: true });
    await writeFile(join(pendingDir, threadId), path);
    marked.add(threadId);
  };

  const failed = (threadId: string, error: unknown): RolloutWriterFailed => {
    clean.delete(threadId);
    if (error instanceof RolloutWriterFailed) return error;
    return new RolloutWriterFailed({ reason: 'io', threadId, message: error instanceof Error ? error.message : String(error) });
  };

  const forget = (threadId: string): void => {
    heads.delete(threadId);
    paths.delete(threadId);
    marked.delete(threadId);
    clean.delete(threadId);
    refused.delete(threadId);
  };

  const onDisk = <A>(threadId: string, work: (read: ReadRollout) => Promise<A>): Effect.Effect<A, RolloutWriterFailed> =>
    Effect.flatMap(RolloutReads, (read) => Effect.tryPromise({ try: () => work(read), catch: (error) => failed(threadId, error) })).pipe(
      Effect.uninterruptible,
    );

  const checkBirth = Effect.fnUntraced(function* (threadId: string, path: string) {
    const traces = [compressedRollout(path), `${path}.opening`, ...(pendingDir === undefined ? [] : [join(pendingDir, threadId)])];
    for (const trace of traces) {
      if ((yield* onDisk(threadId, () => fileSize(trace))) !== null) {
        return yield* new RolloutWriterFailed({
          reason: 'io',
          threadId,
          message: `the rollout at ${path} is missing but ${trace} records an earlier journal; nothing was created`,
        });
      }
    }
  });

  const create = Effect.fnUntraced(function* (threadId: string, path: string, unit: Unit<'machine'> | undefined) {
    if (birth === null || unit === undefined) {
      return yield* new RolloutWriterFailed({ reason: 'io', threadId, message: `the rollout at ${path} does not exist yet` });
    }
    yield* checkBirth(threadId, path);
    const { meta, holds } = yield* birth(threadId, unit);
    yield* onDisk(threadId, async () => {
      const partial = `${path}.partial`;
      await mkdir(dirname(path), { recursive: true });
      await rm(partial, { force: true });
      await writeFile(partial, line(meta) + holds.map((row) => line({ kind: 'hold', row })).join(''), { flag: 'wx' });
      await link(partial, path);
      await rm(partial);
    });
  });

  return {
    pendingRollouts: (): Effect.Effect<readonly PendingRollout[]> => {
      const dir = pendingDir;
      if (dir === undefined) return Effect.succeed([]);
      return Effect.promise(async () => {
        if ((await fileSize(dir)) === null) return [];
        const pending: PendingRollout[] = [];
        for (const threadId of await readdir(dir)) {
          pending.push({ threadId, path: await readFile(join(dir, threadId), 'utf8') });
        }
        return pending;
      });
    },
    unmark: (threadId: string): Effect.Effect<void> => {
      marked.delete(threadId);
      const dir = pendingDir;
      if (dir === undefined) return Effect.void;
      return Effect.promise(() => rm(join(dir, threadId), { force: true }));
    },
    remark: (pending: PendingRollout): Effect.Effect<void> => Effect.promise(() => markPending(pending.threadId, pending.path)),
    unopened: (threadId: string): boolean => !heads.has(threadId),
    held: (threadId: string): number | undefined => heads.get(threadId)?.position,
    refuse: (threadId: string, failure: RolloutWriterFailed): void => {
      refused.set(threadId, failure);
    },
    refusal: (threadId: string): RolloutWriterFailed | undefined => refused.get(threadId),
    head: Effect.fnUntraced(function* (threadId: string, projectId: number | undefined, unit?: Unit<'machine'>) {
      const held = heads.get(threadId);
      if (held !== undefined) return held.position;
      const path = projectId === undefined ? undefined : pathOf(projectId, threadId);
      paths.set(threadId, path ?? null);
      if (path === undefined) return null;
      const size = yield* onDisk(threadId, () => fileSize(path));
      if (size === null) yield* create(threadId, path, unit);
      return yield* onDisk(threadId, async (read) => {
        const tail = await tailOfRollout(path, read);
        if (!tail.meta) {
          throw new RolloutWriterFailed({
            reason: 'not-a-rollout',
            threadId,
            message: `the rollout at ${path} has no meta line and cannot be appended to`,
          });
        }
        await cutTornTail(path, read);
        clean.add(threadId);
        return tail.position;
      });
    }),
    checkBirth,
    adopt: (threadId: string, from: number, rows: readonly ThreadEventRow[]): Effect.Effect<void, RolloutWriterFailed> =>
      Effect.tryPromise({
        try: async () => {
          if (heads.has(threadId)) return;
          const path = paths.get(threadId) ?? null;
          let head = from;
          if (path !== null && rows.some((row) => row.position > head)) await markPending(threadId, path);
          const fresh = rows.filter((row) => row.position > head);
          if (path !== null && fresh.length > 0) {
            await appendExisting(path, fresh.map((row) => line({ kind: 'event', row })).join(''));
            clean.add(threadId);
          }
          for (const row of fresh) head = row.position;
          heads.set(threadId, { position: head });
          refused.delete(threadId);
        },
        catch: (error) => failed(threadId, error),
      }).pipe(Effect.uninterruptible),
    carry: Effect.fn('ThreadJournal.carry')(function* (threadId: string, rows: readonly ThreadEventRow[]) {
      yield* Effect.annotateCurrentSpan({ threadId, rows: rows.length });
      const held = heads.get(threadId);
      const first = rows[0];
      const path = paths.get(threadId) ?? null;
      if (held === undefined || first === undefined || path === null) return;
      if (first.position !== held.position + 1) {
        forget(threadId);
        return;
      }
      const text = yield* Effect.sync(() => rows.map((row) => line({ kind: 'event', row })).join('')).pipe(
        Effect.withSpan('ThreadJournal.carry.encode', { attributes: { rows: rows.length } }),
      );
      yield* onDisk(threadId, async () => {
        await markPending(threadId, path);
        await appendExisting(path, text);
        clean.add(threadId);
      }).pipe(
        Effect.tapError(() => Effect.sync(() => forget(threadId))),
        Effect.withSpan('ThreadJournal.carry.file', { attributes: { bytes: text.length } }),
      );
      if (heads.get(threadId) === held) held.position = rows[rows.length - 1]!.position;
    }),
    appendRecord: (threadId: string, projectId: number, record: unknown): Effect.Effect<void, RolloutWriterFailed> =>
      onDisk(threadId, async (read) => {
        const path = paths.get(threadId) ?? pathOf(projectId, threadId);
        if (path === undefined || (await fileSize(path)) === null) return;
        await markPending(threadId, path);
        if (!clean.has(threadId)) await cutTornTail(path, read);
        await appendExisting(path, `${JSON.stringify(record)}\n`);
        clean.add(threadId);
      }),
    forget,
  };
};

export class RolloutWriting extends Context.Service<RolloutWriting, RolloutWriter>()('tagma/threads/RolloutWriting') {}
