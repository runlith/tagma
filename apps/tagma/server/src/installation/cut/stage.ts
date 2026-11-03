import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import {
  compareReleases,
  type Feed,
  type FeedArchive,
  FEED_FILE,
  type FeedRelease,
  feedArchiveSchema,
  feedSchema,
  platformArchivesSchema,
  RELEASE_NUMBER,
  storeMarksSchema,
} from '../contract/wire/feed.js';
import { IrreversibleChange } from '../contract/wire/manifest.js';
import { RELEASE_LOG, ReleaseRefused } from './release.js';

export const RELEASE_RECORD = 'release.json';
export const MAPS = 'maps';
export const INPUTS = 'inputs';
export const BRAND = 'brand';
const TRIED = 'tried';
const NOTARIZED = 'notarized';
const RETIRED = 'retired';
const NEXT = 'next';
const OWNED = '.cut';

const imageDigestSchema = Schema.Struct({ sha256: feedArchiveSchema.fields.sha256, size: feedArchiveSchema.fields.size });

export const ReleaseRecord = Schema.Struct({
  release: Schema.String.check(Schema.isPattern(RELEASE_NUMBER)),
  commit: Schema.NonEmptyString,
  platforms: platformArchivesSchema,
  images: Schema.Record(Schema.String, Schema.NonEmptyString),
  imageDigests: Schema.optional(Schema.Record(Schema.String, imageDigestSchema)),
  stores: storeMarksSchema,
  irreversible: Schema.Array(IrreversibleChange),
  notarized: Schema.Boolean,
});
export type ReleaseRecord = typeof ReleaseRecord.Type;

export type Identity = Pick<ReleaseRecord, 'release' | 'commit' | 'stores' | 'irreversible'>;

export type BuiltPlatform = { readonly archive: string; readonly image: string };

export type Built = { readonly platforms: Readonly<Record<string, BuiltPlatform>> };

export type Trying = {
  readonly offer: FeedRelease;
  readonly predecessors: Readonly<Record<string, string>>;
  readonly log: string;
};

export type Stages = {
  readonly build: (home: string) => Effect.Effect<Built, ReleaseRefused>;
  readonly trial: (trying: Trying) => Effect.Effect<void, ReleaseRefused>;
};

export type Released = {
  readonly record: ReleaseRecord;
  readonly images: Readonly<Record<string, string>>;
  readonly feed: string;
  readonly maps: string;
  readonly inputs: string;
  readonly log: string;
};

export const decodeRecord = Schema.decodeUnknownResult(Schema.fromJsonString(ReleaseRecord));
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(ReleaseRecord, { space: 2 }));
const encodeFeed = Schema.encodeSync(Schema.fromJsonString(feedSchema, { space: 2 }));

export const feedEntry = (one: ReleaseRecord, address: (archive: string) => string): FeedRelease => ({
  release: one.release,
  platforms: Object.fromEntries(
    Object.entries(one.platforms).map(([platform, archive]) => [platform, { ...archive, archive: address(archive.archive) }]),
  ),
  irreversible: one.irreversible.some((change) => change.release === one.release),
  stores: one.stores,
  changes: one.irreversible,
});

export type Weight = { readonly sha256: string; readonly size: number };

export const weigh = (file: string): Promise<Weight> =>
  new Promise((resolved, failed) => {
    const hash = createHash('sha256');
    let size = 0;
    createReadStream(file)
      .on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      })
      .on('error', failed)
      .on('end', () => resolved({ sha256: hash.digest('hex'), size }));
  });

export const digestOf = (file: string): Promise<string> => weigh(file).then((weight) => weight.sha256);

export const imagesWeighed = (record: ReleaseRecord): boolean =>
  Object.keys(record.platforms).every((platform) => record.imageDigests?.[platform] !== undefined);

export const homeOf = (out: string, cut: Pick<ReleaseRecord, 'release' | 'commit' | 'notarized'>): string =>
  `${out}-${cut.release}-${cut.commit.slice(0, 12)}${cut.notarized ? `-${NOTARIZED}` : ''}`;

const unreadable = (what: string) => (error: PlatformError.PlatformError) =>
  new ReleaseRefused({ step: 'release', detail: `${what} could not be read or written: ${error.reason._tag}`, log: '', unblock: [] });

export const replaced = Effect.fnUntraced(function* (path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.writeFileString(`${path}.part`, text);
  yield* files.rename(`${path}.part`, path);
});

export const recorded = Effect.fn('installation.recordCut')(function* (home: string, record: ReleaseRecord) {
  const feed = join(home, FEED_FILE);
  const local: Feed = { releases: [feedEntry(record, (archive) => pathToFileURL(join(home, archive)).href)] };
  yield* replaced(feed, encodeFeed(local));
  yield* replaced(join(home, RELEASE_RECORD), encodeRecord(record));
  return feed;
});

export const cutFiles = (record: ReleaseRecord): readonly string[] => [
  ...Object.values(record.platforms).map((one) => one.archive),
  ...Object.values(record.images),
];

const recordIn = Effect.fn('installation.cutRecord')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  const at = join(home, RELEASE_RECORD);
  if (!(yield* files.exists(at).pipe(Effect.mapError(unreadable(at))))) return null;
  const decoded = decodeRecord(yield* files.readFileString(at).pipe(Effect.mapError(unreadable(at))));
  if (decoded._tag === 'Failure')
    return yield* new ReleaseRefused({
      step: 'record',
      detail: `${at} does not read as a release record: ${decoded.failure.message}`,
      log: '',
      unblock: [`move the unreadable cut at ${home} aside, then cut the release again`],
    });
  for (const file of cutFiles(decoded.success)) {
    if (!(yield* files.exists(join(home, file)).pipe(Effect.mapError(unreadable(join(home, file)))))) return null;
  }
  return decoded.success;
});

type Kind = 'directory' | 'link' | 'other' | null;

const kindOf = (path: string): Effect.Effect<Kind, ReleaseRefused> =>
  Effect.tryPromise({
    try: () =>
      lstat(path).then(
        (info): Kind => (info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'other'),
        (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : Promise.reject(error)),
      ),
    catch: (error) => new ReleaseRefused({ step: 'release', detail: `${path} could not be read: ${String(error)}`, log: '', unblock: [] }),
  });

export const openHome = Effect.fn('installation.openCut')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(home, { recursive: true }).pipe(Effect.mapError(unreadable(home)));
  yield* files.writeFileString(join(home, OWNED), '').pipe(Effect.mapError(unreadable(home)));
});

export const settle = Effect.fn('installation.settleCut')(function* (out: string) {
  const files = yield* FileSystem.FileSystem;
  if ((yield* kindOf(out)) !== null) return;
  const link = `${out}.${NEXT}`;
  const retired = `${out}.${RETIRED}`;
  if ((yield* kindOf(link)) === 'link') return yield* files.rename(link, out).pipe(Effect.mapError(unreadable(out)));
  if ((yield* kindOf(retired)) === 'directory') yield* files.rename(retired, out).pipe(Effect.mapError(unreadable(out)));
});

export const standingHome = Effect.fn('installation.standingCut')(function* (out: string) {
  const files = yield* FileSystem.FileSystem;
  yield* settle(out);
  if ((yield* kindOf(out)) === null) return null;
  return yield* files.realPath(out).pipe(Effect.mapError(unreadable(out)));
});

export const stand = Effect.fn('installation.standCut')(function* (out: string, home: string) {
  const files = yield* FileSystem.FileSystem;
  const link = `${out}.${NEXT}`;
  const retired = `${out}.${RETIRED}`;
  const legacy = (yield* kindOf(out)) === 'directory';
  if (legacy && (yield* kindOf(retired)) !== null) {
    return yield* new ReleaseRefused({
      step: 'release',
      detail: `${out} is a directory to retire to ${retired}, and ${retired} already stands`,
      log: '',
      unblock: [`move ${retired} away, then run the same command again`],
    });
  }
  yield* files.remove(link, { force: true }).pipe(Effect.mapError(unreadable(link)));
  yield* files.symlink(basename(home), link).pipe(Effect.mapError(unreadable(link)));
  if (legacy) yield* files.rename(out, retired).pipe(Effect.mapError(unreadable(out)));
  yield* files.rename(link, out).pipe(Effect.mapError(unreadable(out)));
  const parent = dirname(out);
  const names = yield* files.readDirectory(parent).pipe(Effect.mapError(unreadable(parent)));
  for (const name of names) {
    const path = join(parent, name);
    const ours =
      name === basename(retired) ||
      (name !== basename(home) &&
        name.startsWith(`${basename(out)}-`) &&
        (yield* files.exists(join(path, OWNED)).pipe(Effect.mapError(unreadable(path)))));
    if (ours) yield* files.remove(path, { recursive: true, force: true }).pipe(Effect.mapError(unreadable(path)));
  }
});

export const releasedAt = (home: string, record: ReleaseRecord): Released => ({
  record,
  images: Object.fromEntries(Object.entries(record.images).map(([platform, image]) => [platform, join(home, image)])),
  feed: join(home, FEED_FILE),
  maps: join(home, MAPS),
  inputs: join(home, INPUTS),
  log: join(home, RELEASE_LOG),
});

export const landNotarized = Effect.fn('installation.landNotarized')(function* (out: string, from: string, record: ReleaseRecord) {
  const files = yield* FileSystem.FileSystem;
  const home = homeOf(out, record);
  for (const part of [MAPS, INPUTS, BRAND, RELEASE_LOG]) {
    const source = join(from, part);
    if (!(yield* files.exists(source).pipe(Effect.mapError(unreadable(source))))) continue;
    yield* files.remove(join(home, part), { recursive: true, force: true }).pipe(Effect.mapError(unreadable(join(home, part))));
    yield* files.copy(source, join(home, part), { overwrite: true }).pipe(Effect.mapError(unreadable(source)));
  }
  yield* recorded(home, record).pipe(Effect.mapError(unreadable(home)));
  yield* stand(out, home);
  return home;
});

export const recordedInPlace = Effect.fn('installation.recordCutInPlace')(function* (home: string, record: ReleaseRecord) {
  yield* recorded(home, record).pipe(Effect.mapError(unreadable(home)));
  return home;
});

export const stagedCut = Effect.fn('installation.stagedCut')(function* (out: string, identity: Identity, stages: Stages) {
  const files = yield* FileSystem.FileSystem;
  const at = yield* standingHome(out);
  const standing = at === null ? null : yield* recordIn(at);
  if (at !== null && standing !== null && standing.release === identity.release && standing.commit === identity.commit) {
    return releasedAt(at, standing);
  }
  const home = homeOf(out, { ...identity, notarized: false });
  const log = join(home, RELEASE_LOG);
  const built = yield* recordIn(home);
  const record =
    built !== null && built.release === identity.release && built.commit === identity.commit
      ? built
      : yield* Effect.gen(function* () {
          yield* files.remove(home, { recursive: true, force: true }).pipe(Effect.mapError(unreadable(home)));
          yield* openHome(home);
          const made = yield* stages.build(home);
          const platforms: Record<string, FeedArchive> = {};
          const images: Record<string, string> = {};
          for (const [platform, { archive, image }] of Object.entries(made.platforms)) {
            images[platform] = relative(home, image);
            const sha256 = yield* Effect.tryPromise({
              try: () => digestOf(archive),
              catch: (error) =>
                new ReleaseRefused({ step: 'record', detail: `${archive} could not be read: ${String(error)}`, log, unblock: [] }),
            });
            const size = (yield* files.stat(archive).pipe(Effect.mapError(unreadable(archive)))).size;
            platforms[platform] = { archive: relative(home, archive), sha256, size: Number(size) };
          }
          const fresh: ReleaseRecord = { ...identity, platforms, images, notarized: false };
          yield* recorded(home, fresh).pipe(Effect.mapError(unreadable(home)));
          return fresh;
        });
  const tried = join(home, TRIED);
  if (!(yield* files.exists(tried).pipe(Effect.mapError(unreadable(tried))))) {
    const predecessors =
      at !== null && standing !== null && compareReleases(standing.release, identity.release) < 0 ? yield* verified(at, standing) : {};
    yield* stages.trial({ offer: feedEntry(record, (name) => pathToFileURL(join(home, name)).href), predecessors, log });
    yield* replaced(tried, '').pipe(Effect.mapError(unreadable(tried)));
  }
  yield* stand(out, home);
  return releasedAt(home, record);
});

const verified = Effect.fn('installation.predecessor')(function* (at: string, standing: ReleaseRecord) {
  const archives: Record<string, string> = {};
  for (const [platform, one] of Object.entries(standing.platforms)) {
    const archive = join(at, one.archive);
    const sha256 = yield* Effect.tryPromise({
      try: () => digestOf(archive),
      catch: (error) =>
        new ReleaseRefused({ step: 'trial', detail: `${archive} could not be read: ${String(error)}`, log: '', unblock: [] }),
    });
    if (sha256 === one.sha256) archives[platform] = archive;
  }
  return archives;
});
