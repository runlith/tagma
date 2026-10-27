import { join } from 'node:path';
import { Effect, FileSystem, Option, Stream } from 'effect';
import type { CheckoutShift } from '../../workspace/contract/service/watch.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { LooseFolders } from '../contract/service/folders.js';
import type { FolderEntry, FolderFrame } from '../contract/wire/scratch.js';
import type { FolderWatches } from '../documents/folders.js';

const READING = 16;

const newer = (one: FolderEntry, two: FolderEntry): boolean =>
  one.modifiedAt !== two.modifiedAt ? one.modifiedAt > two.modifiedAt : one.name < two.name;

const makeOrder = () => {
  const named = new Map<string, FolderEntry>();
  const sorted: FolderEntry[] = [];
  const seat = (entry: FolderEntry): number => {
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (newer(sorted[middle]!, entry)) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const drop = (name: string): void => {
    const standing = named.get(name);
    if (standing === undefined) return;
    sorted.splice(seat(standing), 1);
    named.delete(name);
  };
  return {
    size: () => sorted.length,
    put: (entry: FolderEntry): void => {
      drop(entry.name);
      sorted.splice(seat(entry), 0, entry);
      named.set(entry.name, entry);
    },
    drop,
    newest: (limit: number): readonly FolderEntry[] => sorted.slice(0, limit),
  };
};

const sameEntries = (one: readonly FolderEntry[], two: readonly FolderEntry[]): boolean =>
  one.length === two.length &&
  one.every((entry, index) => {
    const other = two[index]!;
    return entry.name === other.name && entry.kind === other.kind && entry.bytes === other.bytes && entry.modifiedAt === other.modifiedAt;
  });

const unreadable = (path: string) => (failure: { readonly message: string }) =>
  new GateRefusal('files', `${path} could not be read: ${failure.message}`, ['read the report and retry']);

const namedOnly = (shift: CheckoutShift): ReadonlySet<string> | null => {
  if (shift.rescan !== null) return null;
  const names = new Set<string>();
  for (const path of shift.paths.keys()) {
    if (path === '' || path.includes('/')) return null;
    names.add(path);
  }
  return names;
};

export const makeLooseFolders = Effect.fnUntraced(function* (input: { readonly folders: FolderWatches }) {
  const files = yield* FileSystem.FileSystem;

  const entryOf = (directory: string, name: string): Effect.Effect<FolderEntry | null, GateRefusal<'files'>> => {
    const path = join(directory, name);
    return files.stat(path).pipe(
      Effect.map((info): FolderEntry | null =>
        info.type === 'File' || info.type === 'Directory'
          ? {
              name,
              kind: info.type === 'File' ? 'file' : 'directory',
              bytes: Number(info.size),
              modifiedAt: Option.match(info.mtime, { onNone: () => 0, onSome: (at) => at.getTime() }),
            }
          : null,
      ),
      Effect.catchReasons('PlatformError', { NotFound: () => Effect.succeed(null), PermissionDenied: () => Effect.succeed(null) }),
      Effect.mapError(unreadable(path)),
    );
  };

  return LooseFolders.of({
    subscribe: (directory, limit) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const following = yield* Effect.acquireRelease(input.folders.follow(directory), (followed) =>
            Effect.sync(() => followed.release()),
          );
          let order = makeOrder();
          let shown: FolderFrame | null = null;

          const scan = Effect.fn('LooseFolders.scan')(function* () {
            const names = yield* files.readDirectory(directory).pipe(
              Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed<string[]>([])),
              Effect.mapError(unreadable(directory)),
            );
            const fresh = makeOrder();
            yield* Effect.forEach(
              names,
              (name) => Effect.map(entryOf(directory, name), (entry) => (entry === null ? undefined : fresh.put(entry))),
              { concurrency: READING, discard: true },
            );
            order = fresh;
          });

          const touch = Effect.fn('LooseFolders.touch')(function* (names: ReadonlySet<string>) {
            yield* Effect.forEach(
              names,
              (name) => Effect.map(entryOf(directory, name), (entry) => (entry === null ? order.drop(name) : order.put(entry))),
              { concurrency: READING, discard: true },
            );
          });

          const framed = (): FolderFrame | null => {
            const entries = order.newest(limit);
            if (shown !== null && shown.total === order.size() && sameEntries(shown.entries, entries)) return null;
            shown = { directory, entries, total: order.size() };
            return shown;
          };

          return Stream.concat(
            Stream.fromEffect(scan()),
            Stream.mapEffect(following.shifts, (shift) => {
              const names = namedOnly(shift);
              return names === null ? scan() : touch(names);
            }),
          ).pipe(
            Stream.map(framed),
            Stream.filter((frame): frame is FolderFrame => frame !== null),
          );
        }),
      ),
  });
});
