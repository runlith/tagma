import { posix } from 'node:path';
import { adapterOf } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Packages } from '../../declarations/corpus';
import { type Alias, resolverOf } from '../../declarations/resolve';
import { production, type Snapshot, within } from '../snapshot';
import type { CallParams } from './params';

export type World = {
  readonly paths: readonly string[];
  readonly read: (path: string) => string | undefined;
  readonly resolve: (specifier: string, from: string) => string | null;
  readonly mentions?: (words: readonly string[]) => ReadonlySet<string> | undefined;
  readonly prefetch?: (paths: readonly string[]) => void;
};

export type Catalog = { readonly packages: Packages; readonly aliases: readonly Alias[] };

const SOURCE = /\.[cm]?[jt]sx?$/;

const VARIANTS = (base: string): readonly string[] => {
  const stem = base.replace(/\.[cm]?js$/, '');
  return [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
};

export const worldOf = (snapshot: Snapshot, catalog?: Catalog, paths: readonly string[] = snapshot.paths): World => {
  const known = { has: (path: string) => snapshot.tree.has(path), [Symbol.iterator]: () => [][Symbol.iterator]() };
  const workspace = catalog === undefined ? undefined : resolverOf(known, catalog.packages, catalog.aliases);
  return {
    paths,
    read: (path) => (snapshot.tree.has(path) ? snapshot.tree.read(path) : undefined),
    resolve: (specifier, from) => {
      const found = adapterOf(ADAPTERS, from).resolve(specifier, from, snapshot.tree);
      if (found !== null && 'to' in found) return found.to;
      if (specifier.startsWith('.')) {
        const base = posix.normalize(posix.join(posix.dirname(from), specifier));
        const local = VARIANTS(base).find((one) => snapshot.tree.has(one));
        if (local !== undefined) return local;
      }
      return workspace?.resolve(specifier, from)[0] ?? null;
    },
    mentions: snapshot.tree.mentions,
  };
};

export const inRegion = (path: string, params: CallParams): boolean => params.region.some((one) => within(path, one));

export const productionPaths = (paths: readonly string[]): readonly string[] =>
  paths.filter((path) => SOURCE.test(path) && production(path));

export const judgedPaths = (paths: readonly string[], params: CallParams): readonly string[] =>
  paths.filter((path) => SOURCE.test(path) && production(path) && inRegion(path, params));

export const allowed = (act: keyof CallParams['allow'], path: string, params: CallParams): boolean =>
  params.allow[act].some((one) => within(path, one));
