import { join } from 'node:path';
import { shallowClone } from '@runlith/git/clone';
import { Data, Effect, FileSystem, Schema } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import { PLUGIN_COMPONENT_KINDS } from '../plugins/contract/wire/rows.js';
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

export class ListAbsent extends Data.TaggedError('ListAbsent')<{ readonly reason: string }> {
  override get message(): string {
    return this.reason;
  }
}

const Detail = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  brings: Schema.Array(Schema.Literals(PLUGIN_COMPONENT_KINDS)),
});
export type Detail = typeof Detail.Type;

export type Details = Readonly<Record<string, Detail>>;

export type Revision = {
  readonly root: string;
  readonly commit: string | null;
  readonly fetched: number;
  readonly format: string;
  readonly text: string;
  readonly details: Details;
  readonly list: MarketplaceList;
};

export type Fetched = Revision & { readonly stage: string | null };

const Stamp = Schema.Struct({
  commit: Schema.NullOr(Schema.String),
  fetched: Schema.Finite,
  format: Schema.String,
  text: Schema.String,
  details: Schema.optional(Schema.Record(Schema.String, Detail)),
});

export const detailed = (list: MarketplaceList, details: Details): MarketplaceList => ({
  ...list,
  entries: list.entries.map((entry) => {
    const detail = Object.hasOwn(details, entry.name) ? details[entry.name] : undefined;
    return detail === undefined
      ? entry
      : {
          ...entry,
          title: entry.title ?? detail.title,
          description: entry.description ?? detail.description,
          brings: entry.brings.length > 0 ? entry.brings : detail.brings,
        };
  }),
});

const decodeStamp = Schema.decodeUnknownEffect(Schema.fromJsonString(Stamp));

export const placeOf = (home: string, id: string): string => join(home, FOLDER, id);

const stampOf = (home: string, id: string): string => join(home, FOLDER, `${id}.json`);

const unreachable = (failure: { readonly message: string }) => new ListUnreachable({ reason: failure.message });

const parsed = (format: ListFormat, text: string) => {
  const read = format.read(text);
  return 'refused' in read ? Effect.fail(new ListUnreadable({ reason: read.refused })) : Effect.succeed(read);
};

const listAt = Effect.fnUntraced(function* (formats: readonly ListFormat[], root: string) {
  const files = yield* FileSystem.FileSystem;
  for (const format of formats) {
    const path = join(root, format.file);
    if (!(yield* files.exists(path).pipe(Effect.mapError(unreachable)))) continue;
    const size = (yield* files.stat(path).pipe(Effect.mapError(unreachable))).size;
    if (Number(size) > LIST_BYTES) return yield* new ListUnreadable({ reason: `${format.file} is larger than ${LIST_BYTES} bytes` });
    const text = yield* files.readFileString(path).pipe(Effect.mapError(unreachable));
    return { format: format.id, text, list: yield* parsed(format, text) };
  }
  return yield* new ListAbsent({
    reason: `it holds no marketplace list: neither ${formats.map((format) => format.file).join(' nor ')}`,
  });
});

export const fetchRevision = Effect.fn('marketplaces.fetch')(function* (input: {
  readonly home: string;
  readonly source: MarketplaceSource;
  readonly formats: readonly ListFormat[];
  readonly now: number;
}): Effect.fn.Return<
  Fetched,
  ListUnreachable | ListUnreadable | ListAbsent,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  const files = yield* FileSystem.FileSystem;
  const { home, source, formats, now } = input;
  if (source.kind === 'folder') {
    if (!(yield* files.exists(source.path).pipe(Effect.mapError(unreachable)))) {
      return yield* new ListUnreachable({ reason: `${source.path} does not exist` });
    }
    const root = yield* files.realPath(source.path).pipe(Effect.mapError(unreachable));
    return { ...(yield* listAt(formats, root)), root, commit: null, fetched: now, details: {}, stage: null };
  }
  yield* files.makeDirectory(join(home, FOLDER, STAGING), { recursive: true }).pipe(Effect.mapError(unreachable));
  const stage = yield* files
    .makeTempDirectory({ directory: join(home, FOLDER, STAGING), prefix: 'list-' })
    .pipe(Effect.mapError(unreachable));
  const root = join(stage, 'repository');
  const listed = Effect.gen(function* () {
    const { commit } = yield* shallowClone({ url: source.url, into: root }).pipe(Effect.mapError(unreachable));
    return { ...(yield* listAt(formats, root)), root, commit, fetched: now, details: {}, stage };
  });
  return yield* listed.pipe(Effect.onError(() => Effect.orDie(files.remove(stage, { recursive: true, force: true }))));
});

export const storedRevision = Effect.fn('marketplaces.store')(function* (home: string, id: string, fetched: Fetched) {
  const files = yield* FileSystem.FileSystem;
  const stamp = stampOf(home, id);
  const next = `${stamp}.next`;
  const { commit, format, text, details } = fetched;
  yield* files.makeDirectory(join(home, FOLDER), { recursive: true });
  yield* files.writeFileString(next, JSON.stringify({ commit, fetched: fetched.fetched, format, text, details }));
  const revision = { root: fetched.root, commit, fetched: fetched.fetched, format, text, details, list: fetched.list } satisfies Revision;
  if (fetched.stage === null) {
    yield* files.rename(next, stamp);
    return { revision, leftovers: [] as readonly string[] };
  }
  const target = placeOf(home, id);
  const former = `${fetched.stage}-former`;
  const standing = yield* files.exists(target);
  const restored = standing ? files.rename(former, target) : Effect.void;
  if (standing) yield* files.rename(target, former);
  yield* files.rename(fetched.root, target).pipe(Effect.tapError(() => restored));
  yield* files.rename(next, stamp).pipe(Effect.tapError(() => Effect.andThen(files.rename(target, fetched.root), restored)));
  return { revision: { ...revision, root: target }, leftovers: [former, fetched.stage] };
});

export const storedRevisionOf = Effect.fnUntraced(function* (input: {
  readonly home: string;
  readonly id: string;
  readonly source: MarketplaceSource;
  readonly formats: readonly ListFormat[];
}) {
  const files = yield* FileSystem.FileSystem;
  const path = stampOf(input.home, input.id);
  if (!(yield* files.exists(path).pipe(Effect.mapError(unreachable)))) return null;
  const text = yield* files.readFileString(path).pipe(Effect.mapError(unreachable));
  const stamp = yield* decodeStamp(text).pipe(Effect.mapError((failure) => new ListUnreadable({ reason: `${path}: ${failure.message}` })));
  const format = input.formats.find((candidate) => candidate.id === stamp.format);
  if (format === undefined)
    return yield* new ListUnreadable({ reason: `its stored list is in ${stamp.format}, a format Tagma does not read` });
  const root = input.source.kind === 'git' ? placeOf(input.home, input.id) : input.source.path;
  const details = stamp.details ?? {};
  return { root, ...stamp, details, list: detailed(yield* parsed(format, stamp.text), details) } satisfies Revision;
});

export const removed = Effect.fn('marketplaces.removed')(function* (paths: readonly string[]) {
  const files = yield* FileSystem.FileSystem;
  for (const path of paths) yield* files.remove(path, { recursive: true, force: true });
});

export const dropRevision = Effect.fn('marketplaces.drop')(function* (home: string, id: string) {
  yield* removed([placeOf(home, id), stampOf(home, id)]);
});

export const dropFetched = Effect.fn('marketplaces.dropFetched')(function* (fetched: Fetched) {
  if (fetched.stage !== null) yield* removed([fetched.stage]);
});

export const clearStaging = Effect.fn('marketplaces.clearStaging')(function* (home: string) {
  yield* removed([join(home, FOLDER, STAGING)]);
});
