import { type Adapters, type Facet, METRICS } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import { facetOf, importsOf, sitesOf, type Tree } from '@runlith/code-facts/tree';
import { type Applied, locationsOf, relocated } from '../rule';
import { type Debt, type Followed, newViolations, type Unjudged, type Verdict, type Violation } from '../verdict';
import type { Budget } from './budget';
import { affected, budgetFor, inspect, movable } from './implementations';
import type { InspectionMemo } from './memo';
import type { Reading } from './reading';
import { ruleOf } from './registry';

export type Change = {
  readonly base: Tree;
  readonly built: Tree;
  readonly paths: readonly string[];
};

export type Move = { readonly from: string; readonly to: string };

const loose = ({ file, specifier }: Unjudged): string => `${file}\0${specifier}`;

const standingOnly = (tree: Tree, adapters: Adapters): Tree => ({
  ...tree,
  imports: (path, reads) => {
    try {
      return importsOf(tree, path, reads, adapters);
    } catch (error) {
      if (error instanceof UnsupportedSource && tree.has(path)) return [];
      throw error;
    }
  },
  sites: (path) => {
    try {
      return sitesOf(tree, path, adapters);
    } catch (error) {
      if (error instanceof UnsupportedSource && tree.has(path)) return [];
      throw error;
    }
  },
  facet: <T>(path: string, facet: Facet<T>): T => {
    try {
      return facetOf(tree, path, facet, adapters);
    } catch (error) {
      if (error instanceof UnsupportedSource && tree.has(path)) return facet.empty;
      throw error;
    }
  },
});

const digestOf = (tree: Tree, path: string, adapters: Adapters, budget: Budget): string => {
  const object = tree.object?.(path);
  if (object !== undefined && budget.source !== undefined) budget.source(object, tree.size?.(path) ?? 0);
  else budget.take(1, tree.size?.(path) ?? 0);
  if (object !== undefined && !adapters.some((adapter) => adapter.parses(path))) return `blob:${object}`;
  try {
    return `body:${facetOf(tree, path, METRICS, adapters).body}`;
  } catch (error) {
    if (!(error instanceof UnsupportedSource)) throw error;
    return `text:${Bun.hash(tree.read(path).replace(/\s+/g, ' ').trim()).toString(16)}`;
  }
};

export const movesOf = (change: Change, adapters: Adapters = ADAPTERS, budget?: Budget): readonly Move[] => {
  const gone = change.paths.filter((path) => change.base.has(path) && !change.built.has(path)).sort();
  const came = change.paths.filter((path) => change.built.has(path) && !change.base.has(path)).sort();
  if (gone.length === 0 || came.length === 0) return [];
  const taking = budget ?? { take: () => undefined };
  const waiting = new Map<string, string[]>();
  for (const path of gone) {
    const key = digestOf(change.base, path, adapters, taking);
    const held = waiting.get(key);
    if (held === undefined) waiting.set(key, [path]);
    else held.push(path);
  }
  const moves: Move[] = [];
  for (const path of came) {
    const from = waiting.get(digestOf(change.built, path, adapters, taking))?.shift();
    if (from !== undefined) moves.push({ from, to: path });
  }
  return moves;
};

const follows = (inspection: Applied, fingerprint: string): boolean =>
  ruleOf(inspection.builtin).follows?.(inspection.params, fingerprint) ?? false;

const following = (
  inspection: Applied,
  moves: readonly Move[],
  base: Reading,
  fresh: readonly Violation[],
  locations: ReadonlyMap<string, ReadonlySet<string>>,
) => {
  const kept = new Set<Violation>();
  const followed: Followed[] = [];
  if (moves.length === 0 || fresh.length === 0) return { kept, followed };
  const anywhere = ruleOf(inspection.builtin).movedBy === 'fingerprint';
  const indexed = new Map<string, Violation[]>();
  for (const one of base.violations) {
    const key = anywhere ? one.fingerprint : one.file;
    let held = indexed.get(key);
    if (held === undefined) indexed.set(key, (held = []));
    held.push(one);
  }
  const arrived = new Map<string, { readonly from: string; readonly count: number }>();
  for (const { from, to } of moves) {
    const candidates = anywhere
      ? [...(locations.get(from) ?? [])].flatMap((fingerprint) => indexed.get(fingerprint) ?? [])
      : (indexed.get(from) ?? []);
    for (const one of candidates) {
      const moved = relocated(inspection, one.fingerprint, from, to);
      if (moved === undefined) continue;
      arrived.set(moved, { from: one.fingerprint, count: (arrived.get(moved)?.count ?? 0) + 1 });
    }
  }
  const used = new Map<string, number>();
  for (const one of fresh) {
    const was = arrived.get(one.fingerprint);
    const taken = used.get(one.fingerprint) ?? 0;
    if (was === undefined || taken >= was.count || !follows(inspection, one.fingerprint)) continue;
    used.set(one.fingerprint, taken + 1);
    kept.add(one);
    if (taken === 0) followed.push({ from: was.from, to: one.fingerprint });
  }
  return { kept, followed };
};

export function judge(
  inspection: Applied,
  change: Change,
  debt: readonly (string | Debt)[],
  adapters: Adapters = ADAPTERS,
  memo?: InspectionMemo,
  budget: Budget = budgetFor(inspection),
): Verdict {
  const paths = [...new Set([...change.paths, ...affected(inspection, change.base, change.built, change.paths, adapters, budget, memo)])];
  const base = inspect(inspection, standingOnly(change.base, adapters), paths, adapters, budget, memo, 'change');
  const built = inspect(inspection, change.built, paths, adapters, budget, memo, 'change');
  return judgeReadings(inspection, change, debt, base, built, adapters, budget, new Set(paths));
}

export function judgeReadings(
  inspection: Applied,
  change: Change,
  debt: readonly (string | Debt)[],
  base: Reading,
  built: Reading,
  adapters: Adapters = ADAPTERS,
  budget: Budget = budgetFor(inspection),
  read: ReadonlySet<string> | null = null,
): Verdict {
  const unmeasured = new Set(base.unjudged.map(loose));
  const covers = (file: string): boolean => change.base.has(file) && (read === null || read.has(file));
  const { violations: fresh, occurrences, standing: held } = newViolations(built.violations, base.violations, debt, { covers });
  let moves: readonly Move[] = [];
  let locations: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  if (base.violations.length > 0 && fresh.some((one) => follows(inspection, one.fingerprint))) {
    const paths = change.paths.filter((path) => change.base.has(path) !== change.built.has(path));
    if (ruleOf(inspection.builtin).movedBy === 'fingerprint')
      locations = locationsOf(
        inspection,
        paths,
        [...base.violations, ...fresh].map((one) => one.fingerprint),
      );
    moves = movesOf({ ...change, paths: paths.filter((path) => movable(inspection, path) || locations.has(path)) }, adapters, budget);
  }
  const { kept, followed } = following(inspection, moves, base, fresh, locations);
  const units = fresh.filter((one) => !kept.has(one));
  const standing = new Set(units.map(({ fingerprint }) => fingerprint));
  const over = occurrences.filter(({ fingerprint }) => standing.has(fingerprint));
  const before = held.filter(({ fingerprint }) => standing.has(fingerprint));
  return {
    violations: units,
    unjudged: built.unjudged.filter((one) => !unmeasured.has(loose(one))),
    followed: followed.length === 0 ? undefined : followed,
    occurrences: over.length === 0 ? undefined : over,
    baseOccurrences: over.length === 0 ? undefined : before,
  };
}
