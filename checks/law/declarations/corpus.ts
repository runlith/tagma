import { posix } from 'node:path';
import { type Facts, SOURCE } from './facts';
import { matcher } from './glob';

export type Package = {
  readonly dir: string;
  readonly name: string;
  readonly exports: unknown;
  readonly entries: readonly string[];
};

export type Packages = {
  readonly named: (name: string) => Package | undefined;
  readonly at: (dir: string) => Package | undefined;
  readonly containing: (path: string) => readonly Package[];
  readonly targeting: (path: string) => readonly Package[];
};

export type ListedPackages = Packages & { readonly all: () => readonly Package[] };

export type Corpus = {
  readonly facts: ReadonlyMap<string, Facts>;
  readonly packages: Packages;
};

export type WholeCorpus = Corpus & { readonly packages: ListedPackages };

export type Reach = { readonly tests: readonly string[] };

const MANIFEST = 'package.json';

export const isManifest = (path: string): boolean =>
  (path === MANIFEST || path.endsWith(`/${MANIFEST}`)) && !path.split('/').includes('node_modules');

export const isSource = (path: string): boolean =>
  SOURCE.test(path) && !path.endsWith('.d.ts') && !path.split('/').includes('node_modules');

export const productionOf = (reach: Reach): ((path: string) => boolean) => {
  const test = matcher(reach.tests);
  return (path) => isSource(path) && !test(path);
};

const leaves = (value: unknown, into: string[]): void => {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const one of value) leaves(one, into);
  else if (value !== null && typeof value === 'object') for (const one of Object.values(value)) leaves(one, into);
};

export const leavesOf = (value: unknown): readonly string[] => {
  const into: string[] = [];
  leaves(value, into);
  return into;
};

export const shapeOf = (pkg: Package): string => JSON.stringify([pkg.name, pkg.exports, pkg.entries]);

const byDir = (left: Package, right: Package): number => (left.dir < right.dir ? -1 : left.dir > right.dir ? 1 : 0);

export const ancestorsOf = (path: string): readonly string[] => {
  const parts = path.split('/').slice(0, -1);
  return ['', ...parts.map((_, at) => parts.slice(0, at + 1).join('/'))];
};

const EXTENSIONLESS = /\.[^./]+$/;

export const targetKeys = (pkg: Package): readonly string[] => {
  const keys = new Set<string>();
  const inside = (path: string): boolean => path === pkg.dir || path.startsWith(`${pkg.dir}/`);
  if (pkg.dir === '') return [];
  for (const leaf of [...pkg.entries, ...leavesOf(pkg.exports)]) {
    const target = posix.normalize(`${pkg.dir}/${leaf}`);
    if (target.includes('*')) {
      const kept: string[] = [];
      for (const part of target.split('/')) {
        if (part.includes('*')) break;
        kept.push(part);
      }
      const stem = kept.join('/');
      if (!inside(stem)) keys.add(`d:${stem}`);
    } else if (!inside(target)) keys.add(`f:${target}`);
  }
  return [...keys];
};

export const keysReaching = (path: string): readonly string[] => {
  const stem = path.replace(EXTENSIONLESS, '');
  const bases = new Set([path, stem, `${stem}.js`, `${stem}.mjs`, `${stem}.cjs`]);
  if (stem.endsWith('/index')) bases.add(stem.slice(0, -'/index'.length));
  return [...[...bases].map((one) => `f:${one}`), ...ancestorsOf(path).map((dir) => `d:${dir}`)];
};

export const listedPackages = (packages: readonly Package[]): ListedPackages => {
  const ordered = [...packages].sort(byDir);
  const dirs = new Map(ordered.map((one) => [one.dir, one]));
  const names = new Map(ordered.map((one) => [one.name, one]));
  return {
    named: (name) => names.get(name),
    at: (dir) => dirs.get(dir),
    containing: (path) => ancestorsOf(path).flatMap((dir) => dirs.get(dir) ?? []),
    targeting: (path) => {
      const wanted = new Set(keysReaching(path));
      return ordered.filter((one) => targetKeys(one).some((key) => wanted.has(key)));
    },
    all: () => ordered,
  };
};

export const packageOf = (path: string, text: string): Package | undefined => {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== 'string') return undefined;
  const dir = posix.dirname(path) === '.' ? '' : posix.dirname(path);
  return {
    dir,
    name: record.name,
    exports: record.exports,
    entries: [...leavesOf(record.bin), ...leavesOf(record.main), ...leavesOf(record.module)],
  };
};
