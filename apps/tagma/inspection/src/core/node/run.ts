import { ADAPTERS } from '@runlith/code-facts/adapters';
import { type FacetMemo, type ParseMemo } from '@runlith/code-facts/blobs';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import { facetOf, sitesOf, type Tree, type TreeChange, type TreeDiffEntry } from '@runlith/code-facts/tree';
import { resolve } from 'node:path';
import type { Applied, Envelope } from '../rule';
import type { Debt, Verdict } from '../verdict';
import {
  budgetOf,
  type Budget,
  calibratedBudgetOf,
  deriveCalibration,
  EnvelopeExceeded,
  getCalibration,
  isCalibratedBuiltin,
  probeOf,
  setCalibration,
  spreadProbe,
  UNBOUNDED,
} from './budget';
import { facetFor, inspect, lists, prefetches, selects } from './implementations';
import { type InspectionMemo, type MemoValue, memoWrites } from './memo';
import { judge, judgeReadings } from './judge';
import { diffEntriesOf, git, pointListingOf, treeIdOf } from './gitTrees';
import { ruleOf } from './registry';
import {
  commitSide,
  commitSideAt,
  environmentOf,
  type LazySide,
  pathsSide,
  seedAt,
  type Side,
  withCheckout,
  withEnvironment,
  worktreeSide,
} from './sides';
import { mergeSlices, planOf, schedule, sliceEnvelopeOf, sliceExceeded, sliceOf, snapshotOf } from './slices';

const MIB = 1024 * 1024;

export const settledLazy = <A>(
  repository: string,
  sides: readonly LazySide[],
  trees: readonly string[],
  first: readonly (readonly string[])[],
  work: (trees: readonly Tree[], memo?: InspectionMemo) => A,
  store?: InspectionMemo,
  budget?: Budget,
  rounds = 20,
): A => {
  for (let round = 0; ; round++) {
    const scratch = new Map<string, MemoValue>();
    const view: InspectionMemo | undefined =
      store === undefined
        ? undefined
        : {
            get: (key) => scratch.get(key) ?? store.get(key),
            set: (key, value) => {
              scratch.set(key, value);
            },
            stats: store.stats,
          };
    const answer = settled(sides, first, work, view, budget);
    const unknowns = sides.map((side) => side.drainUnknown());
    const total = unknowns.reduce((sum, paths) => sum + paths.length, 0);
    if (total === 0 || round >= rounds) {
      if (store !== undefined) for (const [key, value] of scratch) store.set(key, value);
      return answer as A;
    }
    sides.forEach((side, at) => {
      const paths = unknowns[at] ?? [];
      if (paths.length === 0) return;
      side.fill(paths, pointListingOf(repository, trees[at] as string, paths));
    });
  }
};

export const settled = <A>(
  sides: readonly Side[],
  first: readonly (readonly string[])[],
  work: (trees: readonly Tree[], memo?: InspectionMemo) => A,
  store?: InspectionMemo,
  budget?: Budget,
): A => {
  sides.forEach((side, at) => side.fetch(first[at] ?? [], budget));
  for (;;) {
    const missing = sides.map(() => new Set<string>());
    const trees = sides.map((side, at) => side.tree(missing[at]));
    let answer: A | undefined;
    let thrown: unknown;
    const memo = store === undefined ? undefined : memoWrites(store);
    try {
      answer = work(trees, memo);
    } catch (error) {
      thrown = error;
    }
    if (missing.every((one) => one.size === 0)) {
      if (thrown !== undefined) throw thrown;
      memo?.commit();
      return answer as A;
    }
    sides.forEach((side, at) => side.fetch(missing[at] ?? [], budget));
  }
};

export const slicedSide = (
  inspection: Applied,
  side: Side,
  places: readonly string[],
  store: InspectionMemo,
  envelope: Envelope = sliceEnvelopeOf(inspection),
  placed: (tree: Tree) => Tree = (tree) => tree,
) => {
  let snapshot: unknown;
  const plan = settled(
    [side],
    [[]],
    ([tree]) => {
      try {
        snapshot = snapshotOf(inspection, placed(tree as Tree));
      } catch {
        snapshot = undefined;
      }
      return planOf(inspection, placed(tree as Tree), places, snapshot, envelope);
    },
    undefined,
    UNBOUNDED,
  );
  const frontiers: InspectionMemo = new Map();
  const run = schedule(plan);
  for (let step = run.next(); step !== undefined; step = run.next()) {
    try {
      const result = settled(
        [side],
        [[]],
        ([tree]) => {
          const writes = memoWrites(store);
          const trusted = memoWrites(frontiers);
          return { sliced: sliceOf(inspection, placed(tree as Tree), step.scope, writes, trusted, snapshot, places), writes, trusted };
        },
        undefined,
        UNBOUNDED,
      );
      if (result.sliced.needs.length === 0) {
        result.writes.commit();
        result.trusted.commit();
      }
      run.answer(step, result.sliced);
    } catch (error) {
      if (!sliceExceeded(error)) throw error;
      run.split(step);
    }
  }
  return mergeSlices(run.readings());
};

export const changedPaths = (repository: string, base: string, at: string | null): readonly string[] => {
  if (at === null) {
    const diff = git(repository, ['diff', '--name-only', '--no-renames', '-z', base, '--']).toString().split('\0');
    const untracked = git(repository, ['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0');
    return [...new Set([...diff, ...untracked].filter((path) => path !== ''))].sort();
  }
  return [...new Set(diffEntriesOf(repository, base, at).map((entry) => entry.path))].sort();
};

export const lazySeedOf = (entries: readonly TreeDiffEntry[], paths: readonly string[]): readonly string[] =>
  [...new Set([...paths, ...entries.map((entry) => entry.path)])].sort();

const admitted = (inspection: Applied, side: Side, paths: readonly string[]) => {
  const calibration = getCalibration(inspection.builtin);
  const envelope = ruleOf(inspection.builtin).envelope;
  if (calibration === undefined && envelope === undefined) return;
  const bytes = paths.reduce((sum, path) => sum + (side.size(path) ?? 0), 0);
  if (calibration !== undefined) return calibratedBudgetOf(inspection.builtin, calibration).take(paths.length, bytes);
  if (envelope === undefined) return;
  if (paths.length > envelope.files || bytes > envelope.mib * MIB)
    throw new EnvelopeExceeded(inspection.builtin, paths.length, bytes, envelope);
};

const ensureRunCalibration = (inspection: Applied, sides: readonly Side[], paths: readonly string[]): void => {
  if (
    !isCalibratedBuiltin(inspection.builtin) ||
    ruleOf(inspection.builtin).envelope !== undefined ||
    getCalibration(inspection.builtin) !== undefined
  )
    return;
  const listed = sides.at(-1);
  if (listed === undefined) return;
  const size = (path: string): number => sides.reduce((sum, side) => sum + (side.size(path) ?? 0), 0);
  const probe = probeOf(
    paths,
    (function* () {
      for (const path of listed.paths) if (selects(inspection, path)) yield path;
    })(),
    size,
  );
  const trees = sides.map((side) => side.tree(new Set<string>()));
  const spread = spreadProbe(
    probe,
    sides.map((side, at) => ({ object: (path: string) => trees[at]?.object?.(path), size: side.size })),
  );
  if (spread.files === 0) return;
  const facet = facetFor(inspection.builtin);
  const read = (tree: Tree, path: string): unknown =>
    facet === undefined ? sitesOf(tree, path, ADAPTERS) : facetOf(tree, path, facet, ADAPTERS);
  const started = performance.now();
  sides.forEach((side, at) => {
    const held = spread.held[at] ?? [];
    side.fetch(held);
    const tree = side.tree(new Set<string>());
    for (const path of held) {
      try {
        read(tree, path);
      } catch (error) {
        if (!(error instanceof UnsupportedSource)) throw error;
      }
    }
  });
  setCalibration(inspection.builtin, deriveCalibration(performance.now() - started, spread.files, spread.bytes));
};

export const repositoryPath = (repository: string, path: string): string => {
  const root = resolve(repository);
  const bare = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  return bare.replace(/^\.\//, '');
};

export const gitRoot = (at: string): string => git(at, ['rev-parse', '--show-toplevel']).toString().trim();

export const commitOf = (repository: string, ref: string): string =>
  git(repository, ['rev-parse', '--verify', `${ref}^{commit}`])
    .toString()
    .trim();

export type Asked = {
  readonly at: string | null;
  readonly base?: string;
  readonly named?: readonly string[];
  readonly debt: readonly Debt[];
};

export type Measured = { readonly verdict: Verdict; readonly judged: readonly string[] };

export const measure = (repository: string, inspection: Applied, { at, base, named, debt }: Asked): Measured => {
  const parts = lists(inspection);
  const parses: ParseMemo = new Map();
  const facts: FacetMemo = new Map();
  const memo: InspectionMemo = new Map();
  const envelope = ruleOf(inspection.builtin).envelope;
  const sliced = ruleOf(inspection.builtin).sliced === true;
  const environment = environmentOf(repository);
  if (base === undefined) {
    const built =
      at === null
        ? worktreeSide(repository, parts, parses, facts)
        : named === undefined
          ? commitSide(repository, at, parts, parses, facts)
          : pathsSide(repository, treeIdOf(repository, at), named, parts, parses, facts);
    const judged = built.paths.filter((path) => selects(inspection, path));
    ensureRunCalibration(inspection, [built], judged);
    const fetchBudget = budgetOf(inspection.builtin, envelope);
    if (prefetches(inspection.builtin)) admitted(inspection, built, judged);
    const verdict = sliced
      ? slicedSide(inspection, built, [''], memo, sliceEnvelopeOf(inspection), (tree) => withCheckout(environment, tree))
      : settled(
          [built],
          [prefetches(inspection.builtin) ? judged : []],
          ([tree], memo) => inspect(inspection, withCheckout(environment, tree as Tree), judged, undefined, undefined, memo),
          memo,
          fetchBudget,
        );
    return { verdict, judged };
  }
  const baseTree = treeIdOf(repository, base);
  const builtTree = at === null ? undefined : treeIdOf(repository, at);
  if (!sliced && !prefetches(inspection.builtin) && named === undefined && builtTree !== undefined) {
    const baseEntries = diffEntriesOf(repository, baseTree, builtTree);
    const change: TreeChange = { slot: repository, baseTree, builtTree, baseEntries, headTree: null };
    const paths = [...new Set(baseEntries.map((entry) => entry.path))].sort();
    const seed = lazySeedOf(baseEntries, paths);
    const before = commitSideAt(repository, baseTree, parts, parses, facts, { change }, seedAt(repository, baseTree, parts, seed));
    const lazyBuilt = commitSideAt(repository, builtTree, parts, parses, facts, { change }, seedAt(repository, builtTree, parts, seed));
    ensureRunCalibration(inspection, [before, lazyBuilt], paths);
    const verdict = settled(
      [before, lazyBuilt],
      [[], []],
      ([baseTreeObj, builtTreeObj], memo) =>
        judge(
          inspection,
          { base: withEnvironment(environment, baseTreeObj as Tree), built: withCheckout(environment, builtTreeObj as Tree), paths },
          debt,
          undefined,
          memo,
        ),
      memo,
      budgetOf(inspection.builtin, envelope),
    );
    return { verdict, judged: paths };
  }
  const changed = named ?? changedPaths(repository, base, at);
  const before = commitSideAt(repository, baseTree, parts, parses, facts, undefined, seedAt(repository, baseTree, parts, changed));
  const built =
    builtTree === undefined
      ? worktreeSide(repository, parts, parses, facts)
      : named === undefined
        ? commitSideAt(repository, builtTree, parts, parses, facts, undefined, seedAt(repository, builtTree, parts, changed))
        : pathsSide(repository, builtTree, named, parts, parses, facts);
  ensureRunCalibration(inspection, [before, built], changed);
  const fetchBudget = budgetOf(inspection.builtin, envelope);
  if (sliced) {
    const slice = sliceEnvelopeOf(inspection);
    const baseReading = slicedSide(inspection, before, [''], memo, slice, (tree) => withEnvironment(environment, tree));
    const builtReading = slicedSide(inspection, built, [''], memo, slice, (tree) => withCheckout(environment, tree));
    const verdict = settled(
      [before, built],
      [[], []],
      ([baseTree, builtTree], memo) =>
        judgeReadings(inspection, { base: baseTree as Tree, built: builtTree as Tree, paths: changed }, debt, baseReading, builtReading),
      undefined,
      fetchBudget,
    );
    return { verdict, judged: changed };
  }
  const first = prefetches(inspection.builtin) ? changed : [];
  const verdict = settled(
    [before, built],
    [first, first],
    ([baseTree, builtTree], memo) =>
      judge(
        inspection,
        { base: withEnvironment(environment, baseTree as Tree), built: withCheckout(environment, builtTree as Tree), paths: changed },
        debt,
        undefined,
        memo,
      ),
    memo,
    fetchBudget,
  );
  return { verdict, judged: changed };
};
