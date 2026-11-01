import type { TreeDifference } from '@runlith/git/trees';
import type { BlobAt } from '@runlith/git/working';
import { listedAt } from '../directories';
import { boundaryState } from '../architecture/boundaries';
import { isSource, type Packages, productionOf, targetKeys, type Reach } from './corpus';
import { consumptions } from './dead';
import type { DeadParams } from './declaration';
import type { Facts } from './facts';
import { blobsAt, factsAt, importersByName, manifestsAt, movedPackages, WholeRequired } from './index';
import { patternDir, probesOf, type Resolver, resolverOf } from './resolve';

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
    throw new WholeRequired(
      `${what} reaches the repository root, which a change cannot be judged against; remeasure with check_rules over "all"`,
    );
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
  packages: Packages,
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

export const productionAt = (root: string, commit: string, params: Reach): ((path: string) => boolean) => {
  const production = productionOf(params);
  const boundaries = boundaryState(root, commit);
  return (path) => production(path) && !boundaries.testing(path);
};

export const ownersOf = (
  root: string,
  base: string,
  tree: string,
  changes: readonly TreeDifference[],
  params: DeadParams,
): ReadonlySet<string> => {
  const boundaries = [boundaryState(root, base), boundaryState(root, tree)];
  const production = [productionAt(root, base, params), productionAt(root, tree, params)];
  const sources = (path: string): boolean => production.some((accept) => accept(path));
  const roles = new Set<string>();
  for (const change of changes.filter((one) => one.path.startsWith('.tagma/') && one.path.endsWith('.md'))) {
    const modules = boundaries.map((view) => view.card(change.path));
    if (JSON.stringify(modules[0]?.testing) === JSON.stringify(modules[1]?.testing)) continue;
    for (const [at, commit] of [base, tree].entries())
      for (const source of modules[at]?.paths ?? [])
        for (const path of listedAt(root, commit, [source.kind === 'file' ? source.ref : `${source.ref.replace(/\/$/, '')}/`], true).keys())
          if (isSource(path)) roles.add(path);
  }
  const packagesBefore = manifestsAt(root, base);
  const packagesAfter = manifestsAt(root, tree);
  const moved = movedPackages(root, base, tree, changes);
  const sides = [
    { commit: base, packages: packagesBefore, moved: moved.before, which: 'before' as const },
    { commit: tree, packages: packagesAfter, moved: moved.after, which: 'after' as const },
  ].map((side, at) => ({
    ...side,
    production: production[at]!,
    held: factsAt(root, [
      ...sideEntries(changes, side.which, production[at]!),
      ...[...blobsAt(root, side.commit, [...roles].filter(production[at]!))].map(([path, blob]) => ({ path, blob })),
    ]),
  }));
  const owners = new Set<string>(roles);
  for (const one of changes) {
    if (!sources(one.path)) continue;
    owners.add(one.path);
    if (one.before === null || one.after === null) for (const other of alternatives(one.path)) owners.add(other);
  }
  const names = [...new Set([...moved.before, ...moved.after].map((one) => one.name))];
  for (const side of sides) {
    if (side.moved.length === 0) continue;
    const dirs = new Set(side.moved.map((one) => bounded(one.dir, `the manifest of package \`${one.name}\``)));
    const files = new Set<string>();
    for (const one of side.moved)
      for (const key of targetKeys(one)) {
        if (key.startsWith('d:')) dirs.add(bounded(key.slice(2), `the exports of package \`${one.name}\``));
        else for (const probe of probesOf(key.slice(2))) files.add(probe);
      }
    const reached = [...blobsAt(root, side.commit, [...files]).keys()].filter(side.production);
    const resolver = resolverOf(new Set([...listed(root, side.commit, dirs, side.production), ...reached]), side.packages, params.aliases);
    for (const pkg of side.moved) {
      const published = params.published.some((dir) => pkg.dir === dir || (dir !== '' && pkg.dir.startsWith(`${dir}/`)));
      for (const target of published ? resolver.exported(pkg) : pkg.entries.flatMap((entry) => resolver.inside(pkg, entry)))
        owners.add(target);
    }
  }
  if (names.length > 0)
    for (const side of sides)
      for (const [path, file] of factsAt(root, importersByName(root, side.commit, names, side.production)))
        if (!side.held.has(path)) side.held.set(path, file);
  const [before, after] = sides.map((side) => edgesOf(root, side.commit, side.held, side.packages, params, side.production));
  for (const path of new Set([...before!.keys(), ...after!.keys()])) {
    const was = before!.get(path) ?? new Set<string>();
    const is = after!.get(path) ?? new Set<string>();
    for (const edge of was) if (!is.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
    for (const edge of is) if (!was.has(edge)) owners.add(edge.slice(0, edge.indexOf('\0')));
  }
  return owners;
};
