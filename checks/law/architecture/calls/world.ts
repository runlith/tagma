import { posix } from 'node:path';
import { adapterOf } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { production, type Snapshot, within } from '../snapshot';
import type { CallParams } from './params';

export type World = {
  readonly paths: readonly string[];
  readonly read: (path: string) => string | undefined;
  readonly resolve: (specifier: string, from: string) => string | null;
  readonly mentions?: (words: readonly string[]) => ReadonlySet<string> | undefined;
};

const SOURCE = /\.[cm]?[jt]sx?$/;

const VARIANTS = (base: string): readonly string[] => {
  const stem = base.replace(/\.[cm]?js$/, '');
  return [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
};

export const worldOf = (snapshot: Snapshot): World => {
  const read = (path: string): string | undefined => {
    try {
      return snapshot.tree.has(path) ? snapshot.tree.read(path) : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    paths: snapshot.paths,
    read,
    resolve: (specifier, from) => {
      const found = adapterOf(ADAPTERS, from).resolve(specifier, from, snapshot.tree);
      if (found !== null && 'to' in found) return found.to;
      if (!specifier.startsWith('.')) return null;
      const base = posix.normalize(posix.join(posix.dirname(from), specifier));
      return VARIANTS(base).find((one) => snapshot.tree.has(one)) ?? null;
    },
    mentions: snapshot.tree.mentions,
  };
};

export const inRegion = (path: string, params: CallParams): boolean => params.region.some((one) => within(path, one));

export const judgedPaths = (paths: readonly string[], params: CallParams): readonly string[] =>
  paths.filter((path) => SOURCE.test(path) && production(path) && inRegion(path, params));

export const allowed = (act: keyof CallParams['allow'], path: string, params: CallParams): boolean =>
  params.allow[act].some((one) => within(path, one));
