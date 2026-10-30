import type { Finding } from '@runlith/tagma/rules';
import { type Corpus, isSource, movedPackages, productionOf, type Reach } from './corpus';
import { findDead } from './dead';
import type { DeadParams, RepeatedParams } from './declaration';
import { ownersOf, sideEntries } from './frontier';
import type { Facts } from './facts';
import {
  blobsAt,
  type Change,
  factsAt,
  importersByName,
  importersOf,
  listing,
  manifestsAt,
  packagesAt,
  prepare,
  sharingShapes,
} from './index';
import { findRepeated, inRegion, judges, keyOf } from './repeated';

export type Judge<P extends Reach & { readonly region: readonly string[] }> = {
  readonly kind: string;
  readonly whole: (root: string, commit: string, params: P) => readonly Finding[];
  readonly derive: (
    root: string,
    base: string,
    tree: string,
    changes: readonly Change[],
    standing: readonly Finding[],
    params: P,
  ) => readonly Finding[];
};

const ordered = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((left, right) => (left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1));

const wholeAt = (root: string, commit: string, tests: readonly string[]): Corpus => {
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

const deadAt = (root: string, commit: string, owners: ReadonlySet<string>, params: DeadParams): readonly Finding[] => {
  const production = productionOf(params);
  const present = blobsAt(
    root,
    commit,
    [...owners].filter((path) => isSource(path) && production(path) && params.region.some((one) => path.startsWith(one))),
  );
  if (present.size === 0) return [];
  const own = factsAt(
    root,
    [...present].map(([path, blob]) => ({ path, blob })),
  );
  const packages = manifestsAt(root, commit);
  const importers = importersOf(root, commit, new Set(own.keys()), packages, params.aliases, production);
  const facts = new Map<string, Facts>(factsAt(root, importers));
  for (const [path, held] of own) facts.set(path, held);
  return findDead({ facts, packages }, params, new Set(own.keys()));
};

export const dead: Judge<DeadParams> = {
  kind: 'dead-code',
  whole: (root, commit, params) => findDead(wholeAt(root, commit, params.tests), params),
  derive: (root, base, tree, changes, standing, params) => {
    const owners = ownersOf(root, base, tree, changes, params);
    return ordered([...standing.filter((one) => !owners.has(one.path)), ...deadAt(root, tree, owners, params)]);
  },
};

const groupOf = (finding: Finding): string => finding.fingerprint.split(' ')[1]!.split(':').slice(0, 2).join(':');

export const repeated: Judge<RepeatedParams> = {
  kind: 'repeated-declarations',
  whole: (root, commit, params) => findRepeated(wholeAt(root, commit, params.tests), params),
  derive: (root, base, tree, changes, standing, params) => {
    const production = productionOf(params);
    const sources = (path: string): boolean => isSource(path) && production(path);
    const packages = manifestsAt(root, tree);
    const moved = movedPackages(manifestsAt(root, base), packages);
    const names = [...new Set([...moved.before, ...moved.after].map((one) => one.name))];
    const sides = {
      before: factsAt(root, sideEntries(changes, 'before', sources)),
      after: factsAt(root, sideEntries(changes, 'after', sources)),
    };
    const reached = factsAt(root, importersByName(root, tree, names, sources));
    const keys = new Set<string>();
    for (const held of [sides.before, sides.after, reached])
      for (const [path, file] of held)
        if (inRegion(path, params)) for (const shape of file.shapes) if (judges(shape, params)) keys.add(keyOf(shape));
    if (keys.size === 0) return standing;
    const facts = new Map<string, Facts>(
      factsAt(
        root,
        sharingShapes(root, tree, [...keys]).filter((one) => production(one.path)),
      ),
    );
    for (const [path, held] of sides.after) facts.set(path, held);
    const found = findRepeated({ facts, packages }, params).filter((one) => keys.has(groupOf(one)));
    return ordered([...standing.filter((one) => !keys.has(groupOf(one))), ...found]);
  },
};
