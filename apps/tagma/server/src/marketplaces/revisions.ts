import { join } from 'node:path';
import { shallowClone } from '@runlith/git/clone';
import { Data, Effect, FileSystem, Schema } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import type { ListFormat, MarketplaceList } from './contract/service/lists.js';
import type { MarketplaceSource } from './contract/wire/rows.js';

const FOLDER = 'marketplaces';
const STAGING = '.staging';
const LIST_BYTES = 4 * 1024 * 1024;

export class ListUnreachable extends Data.TaggedError('ListUnreachable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export class ListUnreadable extends Data.TaggedError('ListUnreadable')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

export type Revision = {
  readonly root: string;
  readonly commit: string | null;
  readonly fetched: number;
  readonly format: string;
  readonly list: MarketplaceList;
};

export type Fetched = Revision & { readonly stage: string | null };

const Stamp = Schema.Struct({ commit: Schema.NullOr(Schema.String), fetched: Schema.Finite });
export type Stamp = typeof Stamp.Type;

const decodeStamp = Schema.decodeUnknownEffect(Schema.fromJsonString(Stamp));

export const placeOf = (home: string, id: string): string => join(home, FOLDER, id);

const stampOf = (home: string, id: string): string => join(home, FOLDER, `${id}.json`);

const unreachable = (failure: { readonly message: string }) => new ListUnreachable({ reason: failure.message });

export const listAt = Effect.fnUntraced(function* (formats: readonly ListFormat[], root: string) {
  const files = yield* FileSystem.FileSystem;
  for (const format of formats) {
    const path = join(root, format.file);
    if (!(yield* files.exists(path).pipe(Effect.mapError(unreachable)))) continue;
    const size = (yield* files.stat(path).pipe(Effect.mapError(unreachable))).size;
    if (Number(size) > LIST_BYTES) return yield* new ListUnreadable({ reason: `${format.file} is larger than ${LIST_BYTES} bytes` });
    const read = format.read(yield* files.readFileString(path).pipe(Effect.mapError(unreachable)));
    if ('refused' in read) return yield* new ListUnreadable({ reason: read.refused });
    return { format: format.id, list: read };
  }
  return yield* new ListUnreadable({
    reason: `it holds no marketplace list: neither ${formats.map((format) => format.file).join(' nor ')}`,
  });
});

export const fetchRevision = Effect.fn('marketplaces.fetch')(function* (input: {
  readonly home: string;
  readonly source: MarketplaceSource;
  readonly formats: readonly ListFormat[];
  readonly now: number;
}): Effect.fn.Return<Fetched, ListUnreachable | ListUnreadable, FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner> {
  const files = yield* FileSystem.FileSystem;
  const { home, source, formats, now } = input;
  if (source.kind === 'folder') {
    if (!(yield* files.exists(source.path).pipe(Effect.mapError(unreachable)))) {
      return yield* new ListUnreachable({ reason: `${source.path} does not exist` });
    }
    const root = yield* files.realPath(source.path).pipe(Effect.mapError(unreachable));
    return { ...(yield* listAt(formats, root)), root, commit: null, fetched: now, stage: null };
  }
  yield* files.makeDirectory(join(home, FOLDER, STAGING), { recursive: true }).pipe(Effect.mapError(unreachable));
  const stage = yield* files
    .makeTempDirectory({ directory: join(home, FOLDER, STAGING), prefix: 'list-' })
    .pipe(Effect.mapError(unreachable));
  const root = join(stage, 'repository');
  const listed = Effect.gen(function* () {
    const { commit } = yield* shallowClone({ url: source.url, into: root }).pipe(Effect.mapError(unreachable));
    return { ...(yield* listAt(formats, root)), root, commit, fetched: now, stage };
  });
  return yield* listed.pipe(Effect.tapError(() => files.remove(stage, { recursive: true, force: true }).pipe(Effect.orDie)));
});

export const storedRevision = Effect.fn('marketplaces.store')(function* (home: string, id: string, fetched: Fetched) {
  const files = yield* FileSystem.FileSystem;
  const target = placeOf(home, id);
  let root = fetched.root;
  if (fetched.stage !== null) {
    const former = `${fetched.stage}-former`;
    const standing = yield* files.exists(target);
    if (standing) yield* files.rename(target, former);
    yield* files.rename(fetched.root, target).pipe(Effect.tapError(() => (standing ? files.rename(former, target) : Effect.void)));
    if (standing) yield* files.remove(former, { recursive: true, force: true });
    yield* files.remove(fetched.stage, { recursive: true, force: true });
    root = target;
  }
  yield* files.writeFileString(stampOf(home, id), JSON.stringify({ commit: fetched.commit, fetched: fetched.fetched } satisfies Stamp));
  return { root, commit: fetched.commit, fetched: fetched.fetched, format: fetched.format, list: fetched.list } satisfies Revision;
});

export const readStamp = Effect.fnUntraced(function* (home: string, id: string) {
  const files = yield* FileSystem.FileSystem;
  const path = stampOf(home, id);
  if (!(yield* files.exists(path).pipe(Effect.mapError(unreachable)))) return null;
  const text = yield* files.readFileString(path).pipe(Effect.mapError(unreachable));
  return yield* decodeStamp(text).pipe(Effect.mapError((failure) => new ListUnreadable({ reason: `${path}: ${failure.message}` })));
});

export const dropRevision = Effect.fn('marketplaces.drop')(function* (home: string, id: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(placeOf(home, id), { recursive: true, force: true });
  yield* files.remove(stampOf(home, id), { force: true });
});

export const dropFetched = Effect.fn('marketplaces.dropFetched')(function* (fetched: Fetched) {
  const files = yield* FileSystem.FileSystem;
  if (fetched.stage !== null) yield* files.remove(fetched.stage, { recursive: true, force: true });
});

export const clearStaging = Effect.fn('marketplaces.clearStaging')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.remove(join(home, FOLDER, STAGING), { recursive: true, force: true });
});
