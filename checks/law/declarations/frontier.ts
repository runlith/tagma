import type { TreeDifference } from '@runlith/git/trees';
import type { BlobAt } from '@runlith/git/working';
import { listedAt } from '../directories';
import { isSource, movedPackages, type Package, productionOf } from './corpus';
import { consumptions } from './dead';
import type { DeadParams } from './declaration';
import type { Facts } from './facts';
import { blobsAt, factsAt, importersByName, manifestsAt } from './index';
import { patternDir, type Resolver, resolverOf } from './resolve';

export const sideEntries = (
  changes: readonly TreeDifference[],
  which: 'before' | 'after',
  production: (path: string) => boolean,
): BlobAt[] =>
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

const bounded = (dir: string, what: string): string => {
  if (dir === '')
    throw new Error(`${what} reaches the repository root, which a change cannot be judged against; remeasure with check_rules over "all"`);
  return `${dir}/`;
};

const listed = (root: string, commit: string, dirs: ReadonlySet<string>, production: (path: string) => boolean): string[] =>
  dirs.size === 0 ? [] : [...listedAt(root, commit, [...dirs], true).keys()].filter(production);

const patternDirs = (files: ReadonlyMap<string, Facts>): Set<string> => {
  const dirs = new Set<string>();
  for (const [path, file] of files)
    for (const one of file.loads) {
      const dir = one.pattern ? patternDir(one.specifier, path) : undefined;
      if (dir !== undefined) dirs.add(bounded(dir, `the pattern load \`${one.specifier}\` of ${path}`));
    }
  return dirs;
};

const edgesOf = (
  root: string,
  commit: string,
  files: ReadonlyMap<string, Facts>,
  packages: readonly Package[],
  params: DeadParams,
  production: (path: string) => boolean,
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
  const present = new Set([...listed(root, commit, patternDirs(files), production), ...blobsAt(root, commit, [...wanted]).keys()]);
  return visit(resolverOf(present, packages, params.aliases));
};

export const ownersOf = (
  root: string,
  base: string,
  tree: string,
  changes: readonly TreeDifference[],
  params: DeadParams,
): ReadonlySet<string> => {
  const production = productionOf(params);
  const sources = (path: string): boolean => isSource(path) && production(path);
  const packagesBefore = manifestsAt(root, base);
  const packagesAfter = manifestsAt(root, tree);
  const moved = movedPackages(packagesBefore, packagesAfter);
  const sides = [
    { commit: base, packages: packagesBefore, moved: moved.before, held: factsAt(root, sideEntries(changes, 'before', sources)) },
    { commit: tree, packages: packagesAfter, moved: moved.after, held: factsAt(root, sideEntries(changes, 'after', sources)) },
  ];
  const owners = new Set<string>();
  for (const one of changes) {
    if (!sources(one.path)) continue;
    owners.add(one.path);
    if (one.before === null || one.after === null) for (const other of alternatives(one.path)) owners.add(other);
  }
  const names = [...new Set([...moved.before, ...moved.after].map((one) => one.name))];
  for (const side of sides) {
    if (side.moved.length === 0) continue;
    const dirs = new Set(side.moved.map((one) => bounded(one.dir, `the manifest of package \`${one.name}\``)));
    const resolver = resolverOf(new Set(listed(root, side.commit, dirs, sources)), side.packages, params.aliases);
    for (const pkg of side.moved) {
      const published = params.published.some((dir) => pkg.dir === dir || (dir !== '' && pkg.dir.startsWith(`${dir}/`)));
      for (const target of published ? resolver.exported(pkg) : pkg.entries.flatMap((entry) => resolver.inside(pkg, entry)))
        owners.add(target);
    }
  }
  if (names.length > 0)
    for (const side of sides)
      for (const [path, file] of factsAt(root, importersByName(root, side.commit, names, sources)))
        if (!side.held.has(path)) side.held.set(path, file);
  const [before, after] = sides.map((side) => edgesOf(root, side.commit, side.held, side.packages, params, sources));
  for (const path of new Set([...before!.keys(), ...after!.keys()])) {
    const was = before!.get(path) ?? new Set<string>();
    const is = after!.get(path) ?? new Set<string>();
    for (const edge of was) if (!is.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
    for (const edge of is) if (!was.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
  }
  return owners;
};
