import { Effect, Option, type FileSystem } from 'effect';
import { isAbsolute, relative, sep } from 'node:path';
import { DOCUMENT_LIMITS } from '../metadata/policy.js';
import type { MetadataInput } from '../metadata/sources.js';
import { TailScan, type TailEnd, type TailSource, type TailWindow } from './tail.js';

export const TAIL_CHUNK_BYTES = 64 * 1024;
export const TAIL_LIMIT_BYTES = 8 * 1024 * 1024;

export type TailRead =
  | { readonly _tag: 'Read'; readonly end: TailEnd }
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Unreadable'; readonly reason: string };

const unreadable = (reason: string): TailRead => ({ _tag: 'Unreadable', reason });

const inside = (root: string, path: string): boolean => {
  const part = relative(root, path);
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};

const parsed = (bytes: Uint8Array): unknown[] => {
  if (bytes.length === 0) return [];
  try {
    return [JSON.parse(new TextDecoder().decode(bytes))];
  } catch {
    return [];
  }
};

const readSpan = Effect.fnUntraced(function* (file: FileSystem.File, from: number, length: number) {
  const whole = new Uint8Array(length);
  yield* file.seek(BigInt(from), 'start');
  let placed = 0;
  while (placed < length) {
    const part = Option.getOrElse(yield* file.readAlloc(length - placed), () => new Uint8Array());
    if (part.length === 0) break;
    whole.set(part, placed);
    placed += part.length;
  }
  return whole.subarray(0, placed);
});

const joined = (head: Uint8Array, tail: Uint8Array): Uint8Array => {
  const both = new Uint8Array(head.length + tail.length);
  both.set(head, 0);
  both.set(tail, head.length);
  return both;
};

const NEWLINE = 10;

const segments = (bytes: Uint8Array): Uint8Array[] => {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] !== NEWLINE) continue;
    parts.push(bytes.subarray(start, at));
    start = at + 1;
  }
  parts.push(bytes.subarray(start));
  return parts;
};

export const ADDRESS_WINDOW_BYTES = 256 * 1024;

export const readBefore = Effect.fn('HarnessEnds.before')(
  function* (files: FileSystem.FileSystem, source: TailSource, input: MetadataInput, until: number, bytes: number = ADDRESS_WINDOW_BYTES) {
    const where = source.locate(input);
    if (where === null || !isAbsolute(where.root) || !isAbsolute(where.path) || !inside(where.root, where.path)) return null;
    const real = yield* files.realPath(where.path);
    if (!inside(yield* files.realPath(where.root), real)) return null;
    const file = yield* files.open(real, { flag: 'r' });
    const from = Math.max(0, until - bytes);
    return new TextDecoder().decode(yield* readSpan(file, from, until - from));
  },
  Effect.scoped,
  Effect.catchTag('PlatformError', () => Effect.succeed(null)),
);

export const readTail = Effect.fn('HarnessEnds.read')(
  function* (
    files: FileSystem.FileSystem,
    source: TailSource,
    input: MetadataInput,
    window: TailWindow,
    chunkBytes: number = TAIL_CHUNK_BYTES,
  ) {
    const where = source.locate(input);
    if (where === null) return unreadable('source-location-unavailable');
    if (!isAbsolute(where.root) || !isAbsolute(where.path) || !inside(where.root, where.path)) return unreadable('path');
    const real = yield* files.realPath(where.path);
    if (!inside(yield* files.realPath(where.root), real)) return unreadable('path');
    const file = yield* files.open(real, { flag: 'r' });
    const info = yield* file.stat;
    if (info.type !== 'File') return unreadable('identity');
    const size = Number(info.size);
    const scan = new TailScan(source.reader, window);
    if (source.reader.shape === 'document') {
      if (size > DOCUMENT_LIMITS.recordBytes) return unreadable('limit');
      const [document] = parsed(yield* readSpan(file, 0, size));
      if (document === undefined) return unreadable('malformed');
      const steps = source.reader.records?.(document) ?? [];
      scan.feed([...steps].reverse());
      return { _tag: 'Read', end: scan.finish() } as const;
    }
    const floor = source.reader.window === 'offset' ? window.offset : 0;
    if (floor === null) return unreadable('window-unavailable');
    if (floor > size) return unreadable('changed');
    let position = size;
    let carry: Uint8Array = new Uint8Array();
    while (position > floor || carry.length > 0) {
      const from = Math.max(floor, position - chunkBytes);
      const bytes = joined(yield* readSpan(file, from, position - from), carry);
      const lines = segments(bytes);
      const whole = from === floor;
      carry = whole ? new Uint8Array() : (lines.shift() ?? new Uint8Array());
      position = from;
      if (size - from + carry.length > TAIL_LIMIT_BYTES) return unreadable('limit');
      const ended = scan.feed(lines.reverse().flatMap(parsed));
      if (ended !== null) return { _tag: 'Read', end: ended } as const;
      if (whole) break;
    }
    return { _tag: 'Read', end: scan.finish() } as const;
  },
  Effect.scoped,
  Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed({ _tag: 'Absent' } as const)),
  Effect.catchTag('PlatformError', (failure) => Effect.succeed(unreadable(failure.reason._tag))),
);
