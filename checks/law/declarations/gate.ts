import type { TreeDifference } from '@runlith/git/trees';
import type { Finding } from '@runlith/tagma/rules';
import { boundaryState } from '../architecture/boundaries';
import { modulesAt } from '../architecture/snapshot';
import { listedAt } from '../directories';
import { isSource, listedPackages, type Reach, type WholeCorpus } from './corpus';
import { findDead, findDeadAmong } from './dead';
import type { DeadParams, RepeatedParams } from './declaration';
import { ownersOf, productionAt, sideEntries } from './frontier';
import type { Facts } from './facts';
import {
  blobsAt,
  factsAt,
  importersByName,
  importersOf,
  listing,
  manifestsAt,
  movedPackages,
  packagesAt,
  prepare,
  sharingShapes,
} from './index';
import { findRepeated, inRegion, judges, keyOf } from './repeated';

export type Affected = {
  readonly paths: ReadonlySet<string>;
  readonly base: readonly Finding[];
  readonly tree: readonly Finding[];
};

export type Judge<P extends Reach & { readonly region: readonly string[] }> = {
  readonly kind: string;
  readonly whole: (root: string, commit: string, params: P) => readonly Finding[];
  readonly affected: (root: string, base: string, tree: string, changes: readonly TreeDifference[], params: P) => Affected;
};

const ordered = (findings: readonly Finding[]): readonly Finding[] =>
  [...findings].sort((left, right) => (left.path === right.path ? (left.line ?? 0) - (right.line ?? 0) : left.path < right.path ? -1 : 1));

const wholeAt = (root: string, commit: string, tests: readonly string[]): WholeCorpus => {
  prepare(root, commit, null);
  boundaryState(root, commit, modulesAt(root, commit));
  const production = productionAt(root, commit, { tests });
  const all = listing(root, commit);
  return {
    facts: factsAt(
      root,
      all.filter((one) => production(one.path)),
    ),
    packages: listedPackages(
      packagesAt(
        root,
        all.filter((one) => !isSource(one.path)),
      ),
    ),
  };
};

const deadAt = (root: string, commit: string, owners: ReadonlySet<string>, params: DeadParams): readonly Finding[] => {
  const production = productionAt(root, commit, params);
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
  return findDeadAmong({ facts, packages }, params, new Set(own.keys()));
};

export const dead: Judge<DeadParams> = {
  kind: 'dead-code',
  whole: (root, commit, params) => findDead(wholeAt(root, commit, params.tests), params),
  affected: (root, base, tree, changes, params) => {
    const owners = ownersOf(root, base, tree, changes, params);
    return { paths: owners, base: ordered(deadAt(root, base, owners, params)), tree: ordered(deadAt(root, tree, owners, params)) };
  },
};

const sharedKeys = (files: ReadonlyMap<string, Facts>, params: RepeatedParams): Set<string> => {
  const keys = new Set<string>();
  for (const [path, file] of files)
    if (inRegion(path, params)) for (const shape of file.shapes) if (judges(shape, params)) keys.add(keyOf(shape));
  return keys;
};

const repeatedAt = (
  root: string,
  commit: string,
  paths: ReadonlySet<string>,
  params: RepeatedParams,
  production: (path: string) => boolean,
): readonly Finding[] => {
  const present = blobsAt(root, commit, [...paths].filter(production));
  const own = factsAt(
    root,
    [...present].map(([path, blob]) => ({ path, blob })),
  );
  const keys = sharedKeys(own, params);
  if (keys.size === 0) return [];
  const facts = new Map<string, Facts>(
    factsAt(
      root,
      sharingShapes(root, commit, [...keys]).filter((one) => production(one.path)),
    ),
  );
  for (const [path, held] of own) facts.set(path, held);
  return ordered(
    findRepeated({ facts, packages: manifestsAt(root, commit) }, params, boundaryState(root, commit)).filter((one) => paths.has(one.path)),
  );
};

export const repeated: Judge<RepeatedParams> = {
  kind: 'repeated-declarations',
  whole: (root, commit, params) => {
    const corpus = wholeAt(root, commit, params.tests);
    return findRepeated(corpus, params, boundaryState(root, commit, modulesAt(root, commit)));
  },
  affected: (root, base, tree, changes, params) => {
    const beforeProduction = productionAt(root, base, params);
    const afterProduction = productionAt(root, tree, params);
    const production = (path: string): boolean => beforeProduction(path) || afterProduction(path);
    const sources = (path: string): boolean => isSource(path) && production(path);
    const moved = movedPackages(root, base, tree, changes);
    const names = [...new Set([...moved.before, ...moved.after].map((one) => one.name))];
    const boundaries = [boundaryState(root, base), boundaryState(root, tree)];
    const ids = new Set<string>();
    for (const change of changes.filter((one) => one.path.startsWith('.tagma/') && one.path.endsWith('.md'))) {
      const modules = boundaries.flatMap((view) => view.card(change.path) ?? []);
      if (JSON.stringify(modules[0]) === JSON.stringify(modules[1])) continue;
      for (const module of modules) {
        ids.add(module.id);
        for (const view of boundaries) for (const id of view.dependents(module.id)) ids.add(id);
      }
    }
    const related = [base, tree].map((commit, at) => {
      const paths = new Set<string>();
      for (const id of ids)
        for (const source of boundaries[at]!.module(id)?.paths ?? []) {
          const scope = source.kind === 'file' ? source.ref : `${source.ref.replace(/\/$/, '')}/`;
          for (const path of listedAt(root, commit, [scope], true).keys()) if (sources(path)) paths.add(path);
        }
      return factsAt(
        root,
        [...blobsAt(root, commit, [...paths])].map(([path, blob]) => ({ path, blob })),
      );
    });
    const seeds = new Map<string, Facts>();
    const keys = new Set<string>();
    for (const held of [
      ...related,
      factsAt(root, sideEntries(changes, 'before', sources)),
      factsAt(root, sideEntries(changes, 'after', sources)),
      ...[base, tree].map((commit) => factsAt(root, importersByName(root, commit, names, sources))),
    ]) {
      for (const key of sharedKeys(held, params)) keys.add(key);
      for (const [path, file] of held) seeds.set(path, file);
    }
    const paths = new Set<string>(changes.filter((one) => sources(one.path)).map((one) => one.path));
    for (const path of seeds.keys()) paths.add(path);
    if (keys.size > 0)
      for (const commit of [base, tree])
        for (const one of sharingShapes(root, commit, [...keys])) if (production(one.path)) paths.add(one.path);
    return {
      paths,
      base: repeatedAt(root, base, paths, params, beforeProduction),
      tree: repeatedAt(root, tree, paths, params, afterProduction),
    };
  },
};
