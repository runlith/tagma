import type { Finding } from '@runlith/tagma/rules';
import { type Corpus, isManifest, isSource, productionOf, type Reach } from './corpus';
import { consumptions, findDead } from './dead';
import type { DeadParams, RepeatedParams } from './declaration';
import type { Facts } from './facts';
import {
  type Blobbed,
  blobsAt,
  type Change,
  factsAt,
  importersOf,
  listing,
  manifestsAt,
  packagesAt,
  prepare,
  sharingShapes,
} from './index';
import { findRepeated, inRegion, judges, keyOf } from './repeated';
import { type Resolver, resolverOf } from './resolve';

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
  ) => readonly Finding[] | undefined;
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

const sideEntries = (changes: readonly Change[], which: 'before' | 'after', production: (path: string) => boolean): Blobbed[] =>
  changes.flatMap((one) => {
    const blob = one[which];
    return blob !== null && production(one.path) ? [{ path: one.path, blob }] : [];
  });

const alternatives = (path: string): readonly string[] => {
  const stem = path.replace(/\.[cm]?[jt]sx?$|\.svelte$/, '');
  const index = /\/index$/.test(stem) ? stem.slice(0, -'/index'.length) : undefined;
  const extensions = ['.ts', '.tsx', '.js', '.svelte'];
  return [
    ...extensions.map((one) => `${stem}${one}`),
    ...extensions.map((one) => `${stem}/index${one}`),
    ...(index === undefined ? [] : extensions.map((one) => `${index}${one}`)),
  ].filter((one) => one !== path);
};

const edgesOf = (
  root: string,
  commit: string,
  files: ReadonlyMap<string, Facts>,
  packages: Corpus['packages'],
  params: DeadParams,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const wanted = new Set<string>();
  const recording = { has: (path: string) => (wanted.add(path), false), [Symbol.iterator]: () => [][Symbol.iterator]() };
  const visit = (resolver: Resolver): Map<string, Set<string>> => {
    const found = new Map<string, Set<string>>();
    for (const [path, file] of files) {
      const edges = new Set<string>();
      for (const [target, name, runtime] of consumptions(path, file, resolver)) edges.add(`${target}\0${name}\0${runtime ? 1 : 0}`);
      found.set(path, edges);
    }
    return found;
  };
  visit(resolverOf(recording, packages, params.aliases));
  return visit(resolverOf(new Set(blobsAt(root, commit, [...wanted]).keys()), packages, params.aliases));
};

const ownersOf = (
  root: string,
  base: string,
  tree: string,
  changes: readonly Change[],
  params: DeadParams,
): ReadonlySet<string> | undefined => {
  if (changes.some((one) => isManifest(one.path))) return undefined;
  const production = productionOf(params);
  const before = sideEntries(changes, 'before', (path) => isSource(path) && production(path));
  const after = sideEntries(changes, 'after', (path) => isSource(path) && production(path));
  const heldBefore = factsAt(root, before);
  const heldAfter = factsAt(root, after);
  for (const held of [heldBefore, heldAfter]) for (const file of held.values()) if (file.loads.some((one) => one.pattern)) return undefined;
  const owners = new Set<string>();
  for (const one of changes) {
    if (!isSource(one.path) || !production(one.path)) continue;
    owners.add(one.path);
    if (one.before === null || one.after === null) for (const other of alternatives(one.path)) owners.add(other);
  }
  const edgesBefore = edgesOf(root, base, heldBefore, manifestsAt(root, base), params);
  const edgesAfter = edgesOf(root, tree, heldAfter, manifestsAt(root, tree), params);
  for (const one of changes) {
    const was = edgesBefore.get(one.path) ?? new Set<string>();
    const is = edgesAfter.get(one.path) ?? new Set<string>();
    for (const edge of was) if (!is.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
    for (const edge of is) if (!was.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
  }
  return owners;
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
    if (owners === undefined) return undefined;
    return ordered([...standing.filter((one) => !owners.has(one.path)), ...deadAt(root, tree, owners, params)]);
  },
};

const groupOf = (finding: Finding): string => finding.fingerprint.split(' ')[1]!.split(':').slice(0, 2).join(':');

export const repeated: Judge<RepeatedParams> = {
  kind: 'repeated-declarations',
  whole: (root, commit, params) => findRepeated(wholeAt(root, commit, params.tests), params),
  derive: (root, base, tree, changes, standing, params) => {
    const production = productionOf(params);
    const keys = new Set<string>();
    const sides = {
      before: factsAt(
        root,
        sideEntries(changes, 'before', (path) => isSource(path) && production(path)),
      ),
      after: factsAt(
        root,
        sideEntries(changes, 'after', (path) => isSource(path) && production(path)),
      ),
    };
    for (const held of Object.values(sides))
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
    const found = findRepeated({ facts, packages: [] }, params).filter((one) => keys.has(groupOf(one)));
    return ordered([...standing.filter((one) => !keys.has(groupOf(one))), ...found]);
  },
};
