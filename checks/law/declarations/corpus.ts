import { posix } from 'node:path';
import { type Facts, SOURCE } from './facts';
import { matcher } from './glob';

export type Package = {
  readonly dir: string;
  readonly name: string;
  readonly exports: unknown;
  readonly entries: readonly string[];
};

export type Corpus = {
  readonly facts: ReadonlyMap<string, Facts>;
  readonly packages: readonly Package[];
};

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

const signature = (pkg: Package): string => JSON.stringify([pkg.name, pkg.exports, pkg.entries]);

export const movedPackages = (
  before: readonly Package[],
  after: readonly Package[],
): { readonly before: readonly Package[]; readonly after: readonly Package[] } => {
  const was = new Map(before.map((one) => [one.dir, one]));
  const is = new Map(after.map((one) => [one.dir, one]));
  return {
    before: before.filter((one) => {
      const other = is.get(one.dir);
      return other === undefined || signature(other) !== signature(one);
    }),
    after: after.filter((one) => {
      const other = was.get(one.dir);
      return other === undefined || signature(other) !== signature(one);
    }),
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
