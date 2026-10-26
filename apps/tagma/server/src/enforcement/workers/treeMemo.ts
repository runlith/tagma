import { Dependents, type HeldEntry, type MemoValue, Validity } from '@tagma/inspection/node/memo';
import { ChunkedListing, diffTreeAt, listedTreeAt, pointedTreeAt, treeIdAt, type TreeDifference } from '@runlith/git/trees';
import type { Git } from '@runlith/git/Git';
import { totalmem } from 'node:os';
import { Effect, Result } from 'effect';

type Job = { readonly frontiers: Map<string, Map<string, MemoValue>>; readonly snapshots: Map<string, unknown> };

const JOBS_KEPT = 4;
const ACTIVE_REVISIONS = 4;
const jobs = new Map<string, Job>();
type Listed = {
  readonly listing: ChunkedListing;
  readonly bytes: number;
  readonly entry: number;
  readonly root: string;
  readonly tree: string;
  readonly parts: string;
};
const listings = new Map<string, Listed>();
const DERIVED_PATHS = 256;
let listingBytes = 0;
const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export const jobOf = (key: string | undefined): Job => {
  const held = (key === undefined ? undefined : jobs.get(key)) ?? { frontiers: new Map(), snapshots: new Map() };
  if (key === undefined) return held;
  jobs.delete(key);
  jobs.set(key, held);
  for (const stale of [...jobs.keys()].slice(0, Math.max(0, jobs.size - JOBS_KEPT))) jobs.delete(stale);
  return held;
};

export const frontiersOf = (job: Job, commit: string): Map<string, MemoValue> | undefined => {
  if (!OBJECT_NAME.test(commit)) return undefined;
  let held = job.frontiers.get(commit);
  if (held === undefined) held = new Map();
  job.frontiers.delete(commit);
  job.frontiers.set(commit, held);
  if (job.frontiers.size > ACTIVE_REVISIONS) job.frontiers.delete(job.frontiers.keys().next().value as string);
  return held;
};

export const rememberSnapshot = (job: Job, commit: string, snapshot: unknown): void => {
  if (!OBJECT_NAME.test(commit)) return;
  job.snapshots.delete(commit);
  job.snapshots.set(commit, snapshot);
  if (job.snapshots.size > ACTIVE_REVISIONS) job.snapshots.delete(job.snapshots.keys().next().value as string);
};

export const snapshotFor = (job: Job, commit: string): unknown => {
  const held = job.snapshots.get(commit);
  if (held !== undefined) rememberSnapshot(job, commit, held);
  return held;
};

const TREES_KEPT = 256;
const trees = new Map<string, string>();

export const treeOf = Effect.fn('inspecting.tree')(function* (git: Git['Service'], root: string, commit: string) {
  const key = `${root}\0${commit}`;
  const held = trees.get(key);
  if (held !== undefined) return held;
  const tree = yield* treeIdAt(git, root, commit);
  if (!OBJECT_NAME.test(commit)) return tree;
  trees.set(key, tree);
  if (trees.size > TREES_KEPT) trees.delete(trees.keys().next().value as string);
  return tree;
});

export const listingAt = Effect.fn('inspecting.listing')(function* (
  git: Git['Service'],
  root: string,
  commit: string,
  parts: readonly string[],
) {
  const tree = yield* treeOf(git, root, commit);
  const key = `${root}\0${tree}\0${parts.join('\0')}`;
  const kept = listings.get(key);
  if (kept !== undefined) {
    listings.delete(key);
    listings.set(key, kept);
    return kept.listing;
  }
  const { listing, bytes, entry } =
    (yield* derived(git, root, tree, parts)) ??
    (yield* listedTreeAt(git, root, tree, parts).pipe(
      Effect.map(({ listing, bytes }) => ({ listing, bytes, entry: listing.objects.size === 0 ? 0 : bytes / listing.objects.size })),
    ));
  held(key, { listing, bytes, entry, root, tree, parts: parts.join('\0') });
  return listing;
});

const held = (key: string, listed: Listed): void => {
  const capacity = Math.floor(totalmem() / 128);
  if (listed.bytes > capacity) return;
  while (listingBytes + listed.bytes > capacity) {
    const oldest = listings.entries().next().value as [string, Listed] | undefined;
    if (oldest === undefined) break;
    listings.delete(oldest[0]);
    listingBytes -= oldest[1].bytes;
  }
  listings.set(key, listed);
  listingBytes += listed.bytes;
};

const within = (parts: readonly string[], path: string): boolean =>
  parts.some((part) => part === '' || path === part || path.startsWith(`${part.replace(/\/$/, '')}/`));

const dependents = new Dependents(Math.floor(totalmem() / (64 * 1024)));
const VALIDITIES_KEPT = 16;
const validities = new Map<string, Validity>();

const keepValidity = (key: string, validity: Validity): Validity => {
  validities.delete(key);
  validities.set(key, validity);
  if (validities.size > VALIDITIES_KEPT) validities.delete(validities.keys().next().value as string);
  return validity;
};

export const validityOf = (root: string, tree: string): Validity => {
  const key = `${root}\0${tree}`;
  return keepValidity(key, validities.get(key) ?? Validity.fresh(dependents));
};

const LISTINGS_RESTED = 2;

type RestedListing = {
  readonly tree: string;
  readonly parts: string;
  readonly entry: number;
  readonly bytes: number;
  readonly paths: readonly string[];
  readonly objects: readonly string[];
  readonly sizes: readonly number[];
};
export type Rested = {
  readonly entries: readonly HeldEntry[];
  readonly trees: readonly (readonly [string, readonly string[]])[];
  readonly listings: readonly RestedListing[];
};

export const restedOf = (root: string): Rested => {
  const trees = [...validities]
    .filter(([key]) => key.startsWith(`${root}\0`))
    .map(([key, validity]) => [key.slice(root.length + 1), validity.held()] as const);
  const kept = [...listings.values()].filter((one) => one.root === root).slice(-LISTINGS_RESTED);
  return {
    entries: dependents.exported(new Set(trees.flatMap(([, keys]) => keys))),
    trees,
    listings: kept.map(({ listing, tree, parts, entry, bytes }) => {
      const paths = [...listing.ordered];
      return {
        tree,
        parts,
        entry,
        bytes,
        paths,
        objects: paths.map((path) => listing.objects.get(path)!),
        sizes: paths.map((path) => listing.sizes.get(path) ?? 0),
      };
    }),
  };
};

export const restore = (root: string, rested: Rested): void => {
  dependents.imported(rested.entries);
  for (const [tree, keys] of rested.trees)
    if (!validities.has(`${root}\0${tree}`)) keepValidity(`${root}\0${tree}`, Validity.restored(dependents, keys));
  for (const one of rested.listings) {
    const key = `${root}\0${one.tree}\0${one.parts}`;
    if (listings.has(key)) continue;
    const listing = ChunkedListing.of(
      new Map(one.paths.map((path, at) => [path, one.objects[at]!])),
      new Map(one.paths.map((path, at) => [path, one.sizes[at]!])),
    );
    held(key, { listing, bytes: one.bytes, entry: one.entry, root, tree: one.tree, parts: one.parts });
  }
};

const DIFFS_KEPT = 16;
const diffs = new Map<string, readonly TreeDifference[]>();

export const changesBetween = Effect.fn('inspecting.changes')(function* (git: Git['Service'], root: string, from: string, to: string) {
  const key = `${root}\0${from}\0${to}`;
  const held = diffs.get(key);
  if (held !== undefined) return held;
  const changed = yield* diffTreeAt(git, root, from, to);
  diffs.set(key, changed);
  if (diffs.size > DIFFS_KEPT) diffs.delete(diffs.keys().next().value as string);
  return changed;
});

const SNAPSHOTS_NEAR = 8;
const nearest = new Map<string, { readonly tree: string; readonly snapshot: unknown }>();

export const nearSnapshot = (root: string, inspection: string) => nearest.get(`${root}\0${inspection}`);

export const keepNearSnapshot = (root: string, inspection: string, tree: string, snapshot: unknown): void => {
  const key = `${root}\0${inspection}`;
  nearest.delete(key);
  nearest.set(key, { tree, snapshot });
  if (nearest.size > SNAPSHOTS_NEAR) nearest.delete(nearest.keys().next().value as string);
};

const derived = Effect.fn('inspecting.derivedListing')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  parts: readonly string[],
) {
  const near = [...listings.values()].reverse().find((one) => one.root === root && one.parts === parts.join('\0'));
  if (near === undefined) return undefined;
  const between = yield* Effect.result(changesBetween(git, root, near.tree, tree));
  if (Result.isFailure(between)) {
    for (const [key, one] of listings)
      if (one.root === root && one.tree === near.tree) {
        listings.delete(key);
        listingBytes -= one.bytes;
      }
    return undefined;
  }
  const changed = between.success;
  const before = validities.get(`${root}\0${near.tree}`);
  if (before !== undefined && !validities.has(`${root}\0${tree}`)) keepValidity(`${root}\0${tree}`, before.derive(changed));
  const paths = [...new Set(changed.map(({ path }) => path))].filter((path) => within(parts, path));
  if (paths.length > DERIVED_PATHS) return undefined;
  if (paths.length > DERIVED_PATHS) return undefined;
  if (near.listing.ordered.size === 0) return undefined;
  if (paths.length === 0) return { listing: near.listing, bytes: near.bytes, entry: near.entry };
  const pointed = yield* pointedTreeAt(git, root, tree, paths);
  const listing = near.listing.with(
    paths.map((path) => ({ path, object: pointed.objects.get(path) ?? null, size: pointed.sizes.get(path) ?? 0 })),
  );
  return { listing, bytes: Math.ceil(near.entry * listing.ordered.size), entry: near.entry };
});
