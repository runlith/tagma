import type { Finding } from '@runlith/tagma/rules';
import { type Corpus, isSource, productionOf } from './corpus';
import { findDead } from './dead';
import type { DeadParams, RepeatedParams } from './declaration';
import type { Facts } from './facts';
import { type Blobbed, type Change, factsAt, importersOf, listing, manifestsAt, packagesAt, prepare, sharingShapes } from './index';
import { findRepeated, inRegion, judges, keyOf } from './repeated';

export type Which = 'before' | 'after';

const entriesOf = (changes: readonly Change[], which: Which, production: (path: string) => boolean): Blobbed[] =>
  changes.flatMap((one) => {
    const blob = one[which];
    return blob !== null && isSource(one.path) && production(one.path) ? [{ path: one.path, blob }] : [];
  });

export const wholeAt = (root: string, commit: string, tests: readonly string[]): Corpus => {
  prepare(root, commit, null);
  const production = productionOf({ tests });
  const all = listing(root, commit);
  return {
    facts: factsAt(
      root,
      all.filter((one) => production(one.path)),
    ),
    packages: packagesAt(
      root,
      all.filter((one) => !isSource(one.path)),
    ),
  };
};

export const deadAt = (root: string, commit: string, changes: readonly Change[], which: Which, params: DeadParams): readonly Finding[] => {
  const production = productionOf(params);
  const changed = entriesOf(changes, which, production).filter((one) => params.region.some((region) => one.path.startsWith(region)));
  if (changed.length === 0) return [];
  const own = factsAt(root, changed);
  const packages = manifestsAt(root, commit);
  const importers = importersOf(root, commit, new Set(own.keys()), packages, params.aliases, (path) => production(path) && !own.has(path));
  const facts = new Map<string, Facts>(factsAt(root, importers));
  for (const [path, held] of own) facts.set(path, held);
  return findDead({ facts, packages }, params, { judged: new Set(own.keys()), rooted: new Set(importers.map((one) => one.path)) });
};

export const repeatedAt = (
  root: string,
  commit: string,
  changes: readonly Change[],
  which: Which,
  params: RepeatedParams,
): readonly Finding[] => {
  const production = productionOf(params);
  const changed = entriesOf(changes, which, production).filter((one) => inRegion(one.path, params));
  if (changed.length === 0) return [];
  const own = factsAt(root, changed);
  const keys = [...own.values()].flatMap((file) => file.shapes.filter((shape) => judges(shape, params)).map(keyOf));
  if (keys.length === 0) return [];
  const partners = sharingShapes(root, commit, keys).filter((one) => production(one.path) && !own.has(one.path));
  const facts = new Map<string, Facts>(factsAt(root, partners));
  for (const [path, held] of own) facts.set(path, held);
  return findRepeated({ facts, packages: [] }, params).filter((one) => own.has(one.path));
};
