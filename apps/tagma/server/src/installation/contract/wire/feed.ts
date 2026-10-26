import { Schema } from 'effect';
import { IrreversibleChange } from './manifest.js';

export const RELEASE_NUMBER = /^\d+(\.\d+){0,2}$/u;

export const isRelease = (label: string): boolean => RELEASE_NUMBER.test(label);

const parts = (release: string): readonly number[] => release.split('.').map(Number);

export const compareReleases = (left: string, right: string): number => {
  const [a, b] = [parts(left), parts(right)];
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const step = (a[at] ?? 0) - (b[at] ?? 0);
    if (step !== 0) return Math.sign(step);
  }
  return 0;
};

export const FIRST_RELEASE = '0.1.0';

export const releaseAfter = (newest: string | null): string => {
  if (newest === null) return FIRST_RELEASE;
  const [major = 0, minor = 0, patch = 0] = parts(newest);
  return `${major}.${minor}.${patch + 1}`;
};

const names = Schema.Array(Schema.String);

export const storeMarksSchema = Schema.Struct({ 'machine-store': names, 'host-store': names, graph: names, journal: names });
export type StoreMarks = typeof storeMarksSchema.Type;

export const LEGACY_PLATFORM = 'darwin-arm64';

export const feedArchiveSchema = Schema.Struct({
  archive: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type FeedArchive = typeof feedArchiveSchema.Type;
export type ReleaseArchive = FeedArchive & { readonly release: string };

export const platformArchivesSchema = Schema.Record(Schema.String, feedArchiveSchema);
export type PlatformArchives = typeof platformArchivesSchema.Type;

export const feedReleaseSchema = Schema.Struct({
  release: Schema.String.check(Schema.isPattern(RELEASE_NUMBER)),
  ...feedArchiveSchema.fields,
  platforms: Schema.optional(platformArchivesSchema),
  irreversible: Schema.Boolean,
  stores: storeMarksSchema,
  changes: Schema.Array(IrreversibleChange),
});
export type FeedRelease = typeof feedReleaseSchema.Type;

export const archivesOf = (release: FeedRelease): PlatformArchives =>
  release.platforms ?? {
    [LEGACY_PLATFORM]: { archive: release.archive, sha256: release.sha256, size: release.size },
  };

export const feedSchema = Schema.Struct({ releases: Schema.NonEmptyArray(feedReleaseSchema) });
export type Feed = typeof feedSchema.Type;
