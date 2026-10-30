import { Effect, FileSystem, Option } from 'effect';
import { isAbsolute, relative, sep } from 'node:path';
import { MetadataInvalid, type MetadataField, type MetadataFold, type MetadataLocation } from '@runlith/tagma/adapter/metadata';
import { DOCUMENT_LIMITS, METADATA_LIMITS } from './policy.js';

export type MetadataLimits = {
  readonly bytes: number;
  readonly records: number;
  readonly recordBytes: number;
};

export type MetadataMissed = { readonly [K in MetadataField]?: number };

export type MetadataPage<A> =
  | {
      readonly _tag: 'Read';
      readonly value: A;
      readonly complete: boolean;
      readonly bytes: number;
      readonly records: number;
      readonly skipped: number;
      readonly missed?: MetadataMissed;
    }
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Unreadable'; readonly reason: string };

type Fragment = { readonly bytes: Uint8Array; readonly previous: Fragment | null };

type Cursor<A> = {
  readonly identity: string;
  readonly size: number;
  readonly modified: number;
  readonly offset: number;
  readonly fragments: Fragment | null;
  readonly pending: Uint8Array;
  readonly partialBytes: number;
  readonly skipping: boolean;
  readonly skipped: number;
  readonly missed: { [K in MetadataField]?: number } | null;
  readonly value: A;
};

export class MetadataFile<A> {
  private cursor: Cursor<A> | null = null;

  constructor(
    private readonly fold: MetadataFold<A>,
    private readonly limits: MetadataLimits,
    private readonly from: number = 0,
  ) {}

  readonly read = Effect.fn('HarnessMetadata.read')(
    function* (this: MetadataFile<A>, files: FileSystem.FileSystem, root: string, path: string) {
      const { fold, limits, from: start0 } = this;
      if (!isAbsolute(root) || !isAbsolute(path) || !inside(root, path)) return yield* new MetadataInvalid({ reason: 'path' });
      const realRoot = yield* files.realPath(root);
      const real = yield* files.realPath(path);
      if (!inside(realRoot, real) || relative(realRoot, real) !== relative(root, path))
        return yield* new MetadataInvalid({ reason: 'path' });
      if ((yield* files.stat(real)).type !== 'File') return yield* new MetadataInvalid({ reason: 'identity' });
      const file = yield* files.open(real, { flag: 'r' });
      const info = yield* file.stat;
      const identity = identityOf(info);
      if (identity === null || info.type !== 'File') return yield* new MetadataInvalid({ reason: 'identity' });
      const openedPath = yield* files.realPath(path);
      if (openedPath !== real || !inside(realRoot, openedPath) || identityOf(yield* files.stat(openedPath)) !== identity) {
        return yield* new MetadataInvalid({ reason: 'path' });
      }
      const size = Number(info.size);
      if (fold.json === true && size === 0) return yield* new MetadataInvalid({ reason: 'malformed' });
      const modified = Option.getOrNull(info.mtime)?.getTime() ?? 0;
      const floor = fold.json === true ? 0 : start0;
      if (floor > size) return yield* new MetadataInvalid({ reason: 'changed' });
      const before = this.cursor;
      const reset =
        before === null ||
        before.identity !== identity ||
        size < before.size ||
        ((fold.json === true || size === before.size) && modified !== before.modified);
      const cursor: Cursor<A> = reset
        ? {
            identity,
            size,
            modified,
            offset: floor,
            fragments: null,
            pending: new Uint8Array(),
            partialBytes: 0,
            skipping: false,
            skipped: 0,
            missed: fold.missed === undefined ? null : {},
            value: fold.empty(),
          }
        : before;
      yield* file.seek(BigInt(cursor.offset), 'start');
      const available = cursor.pending.length > 0 ? 0 : Math.min(limits.bytes, Math.max(0, size - cursor.offset));
      const read = available === 0 ? new Uint8Array() : Option.getOrElse(yield* file.readAlloc(available), () => new Uint8Array());
      const chunk = cursor.pending.length > 0 ? cursor.pending : read;
      let fragments = cursor.fragments;
      let partialBytes = cursor.partialBytes;
      let skipping = cursor.skipping;
      let skipped = cursor.skipped;
      const judge = fold.missed;
      const missed = cursor.missed === null ? null : { ...cursor.missed };
      const count = (head: Fragment | null, tail: Uint8Array): void => {
        skipped++;
        if (missed === null || judge === undefined) return;
        for (const name of judge(headOf(head, tail))) missed[name] = (missed[name] ?? 0) + 1;
      };
      let value = cursor.value;
      let records = 0;
      let start = 0;
      for (let at = 0; fold.json !== true && at < chunk.length; at++) {
        if (chunk[at] !== 10) continue;
        if (skipping) {
          skipping = false;
          start = at + 1;
          continue;
        }
        const part = chunk.subarray(start, at);
        partialBytes += part.length;
        if (partialBytes > limits.recordBytes) {
          count(fragments, part);
          fragments = null;
          partialBytes = 0;
          start = at + 1;
          continue;
        }
        const line = new Uint8Array(partialBytes);
        let placed = partialBytes - part.length;
        line.set(part, placed);
        for (let fragment = fragments; fragment !== null; fragment = fragment.previous) {
          placed -= fragment.bytes.length;
          line.set(fragment.bytes, placed);
        }
        value = yield* Effect.try({
          try: () => fold.line(value, new TextDecoder('utf-8', { fatal: true }).decode(line)),
          catch: (cause) => (cause instanceof MetadataInvalid ? cause : new MetadataInvalid({ reason: 'malformed' })),
        });
        records++;
        fragments = null;
        partialBytes = 0;
        start = at + 1;
        if (records === limits.records) break;
      }
      const pending = records === limits.records ? chunk.slice(start) : new Uint8Array();
      if (records < limits.records && start < chunk.length && !skipping) {
        const rest = chunk.slice(start);
        const before = fragments;
        fragments = { bytes: rest, previous: fragments };
        partialBytes += rest.length;
        if (partialBytes > limits.recordBytes) {
          if (fold.json === true) return yield* new MetadataInvalid({ reason: 'limit' });
          skipping = true;
          count(before, rest);
          fragments = null;
          partialBytes = 0;
        }
      }
      if (fold.json === true && cursor.offset + read.length === size && partialBytes > 0) {
        const document = new Uint8Array(partialBytes);
        let placed = partialBytes;
        for (let fragment = fragments; fragment !== null; fragment = fragment.previous) {
          placed -= fragment.bytes.length;
          document.set(fragment.bytes, placed);
        }
        value = yield* Effect.try({
          try: () => fold.line(fold.empty(), new TextDecoder('utf-8', { fatal: true }).decode(document)),
          catch: (cause) => (cause instanceof MetadataInvalid ? cause : new MetadataInvalid({ reason: 'malformed' })),
        });
        fragments = null;
        partialBytes = 0;
        records = 1;
      }
      const afterPath = yield* files.realPath(path);
      const after = yield* files.stat(afterPath);
      if (
        afterPath !== real ||
        !inside(realRoot, afterPath) ||
        identityOf(after) !== identity ||
        Number(after.size) < size ||
        (Number(after.size) === size && Option.getOrNull(after.mtime)?.getTime() !== modified)
      ) {
        this.cursor = null;
        return yield* new MetadataInvalid({ reason: 'changed' });
      }
      this.cursor = {
        identity,
        size,
        modified,
        offset: cursor.offset + read.length,
        fragments,
        pending,
        partialBytes,
        skipping,
        skipped,
        missed,
        value,
      };
      yield* Effect.annotateCurrentSpan({ bytes: read.length, records, skipped, reset });
      return {
        _tag: 'Read',
        value,
        complete: this.cursor.offset === size && partialBytes === 0 && pending.length === 0,
        bytes: read.length,
        records,
        skipped,
        missed: missed ?? undefined,
      } as MetadataPage<A>;
    },
    Effect.scoped,
    Effect.catchTag('MetadataInvalid', (failure) => Effect.succeed({ _tag: 'Unreadable', reason: failure.reason } as MetadataPage<A>)),
    Effect.catchTag('PlatformError', (failure) =>
      Effect.succeed(
        failure.reason._tag === 'NotFound'
          ? ({ _tag: 'Absent' } as MetadataPage<A>)
          : ({ _tag: 'Unreadable', reason: failure.reason._tag } as MetadataPage<A>),
      ),
    ),
  );
}

export const fileLocationReader = (source: Extract<MetadataLocation, { readonly kind: 'file' }>) => {
  const cursor = new MetadataFile(source.fold, source.fold.json === true ? DOCUMENT_LIMITS : METADATA_LIMITS);
  return (files: FileSystem.FileSystem) =>
    cursor
      .read(files, source.root, source.path)
      .pipe(
        Effect.map((page) =>
          page._tag === 'Absent' && source.computed === true ? ({ _tag: 'Unreadable', reason: 'session-path-unresolved' } as const) : page,
        ),
      );
};

const inside = (root: string, path: string): boolean => {
  const part = relative(root, path);
  return part !== '' && !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
};

const HEAD_BYTES = 512;

const headOf = (fragments: Fragment | null, tail: Uint8Array): string => {
  const parts: Uint8Array[] = [];
  for (let fragment = fragments; fragment !== null; fragment = fragment.previous) parts.push(fragment.bytes);
  parts.reverse();
  parts.push(tail);
  const head = new Uint8Array(HEAD_BYTES);
  let placed = 0;
  for (const part of parts) {
    if (placed === HEAD_BYTES) break;
    const take = Math.min(part.length, HEAD_BYTES - placed);
    head.set(part.subarray(0, take), placed);
    placed += take;
  }
  return new TextDecoder('utf-8').decode(head.subarray(0, placed));
};

const identityOf = (info: FileSystem.File.Info): string | null => {
  const inode = Option.getOrNull(info.ino);
  const born = Option.getOrNull(info.birthtime);
  return inode === null || born === null ? null : `${info.dev}:${inode}:${born.getTime()}`;
};
