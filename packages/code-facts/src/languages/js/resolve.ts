import { posix } from 'node:path';
import type { Resolution } from '../../adapter';
import type { Tree } from '../../tree';

const COMPILED = /\.[cm]?js$/;

const aimed = (specifier: string, from: string): string => posix.join(posix.dirname(from), specifier).replace(/(.)\/+$/, '$1');

export function relativeCandidates(specifier: string, from: string): readonly string[] {
  const base = aimed(specifier, from);
  const extensions = ['.mjs', '.js', '.mts', '.ts', '.tsx', '.jsx', '.json', '.cjs', '.cts'];
  return [
    ...new Set([
      base,
      base.replace(/\.[cm]?js$/, '.ts'),
      ...extensions.map((extension) => `${base}${extension}`),
      ...extensions.map((extension) => posix.join(base, `index${extension}`)),
    ]),
  ];
}

export type RelativeReading =
  | { readonly to: string }
  | { readonly unresolved: string; readonly candidates: readonly string[]; readonly absent: readonly string[] };

export function resolveUnique(specifier: string, from: string, tree: Tree): RelativeReading {
  const candidates = relativeCandidates(specifier, from);
  if (!COMPILED.test(specifier) && tree.has(candidates[0]!)) return { to: candidates[0]! };
  const found = candidates.filter((path) => tree.has(path));
  if (found.length === 1) return { to: found[0]! };
  return found.length === 0
    ? { unresolved: 'no file resolves the specifier', candidates: found, absent: candidates }
    : { unresolved: 'more than one file resolves the specifier', candidates: found, absent: [] };
}

export function resolveRelative(specifier: string, from: string, tree: Tree): string | null {
  if (!specifier.startsWith('.')) return null;
  for (const candidate of probeOrder(aimed(specifier, from))) {
    if (tree.has(candidate)) return candidate;
  }
  return null;
}

export function missedBeforeHit(specifier: string, from: string, tree: Tree): readonly string[] {
  if (!specifier.startsWith('.')) return [];
  const missed: string[] = [];
  for (const candidate of probeOrder(aimed(specifier, from))) {
    if (tree.has(candidate)) return missed;
    if (!missed.includes(candidate)) missed.push(candidate);
  }
  return [];
}

const probeOrder = (base: string): readonly string[] => {
  const compiled = base.replace(/\.[cm]?js$/, '.ts');
  return [base, compiled, `${base}.ts`, `${base}.tsx`, posix.join(base, 'index.ts')];
};

export function resolve(specifier: string, from: string, tree: Tree): Resolution | null {
  if (!specifier.startsWith('.')) return null;
  const to = resolveRelative(specifier, from, tree);
  return to === null ? { unlisted: aimed(specifier, from) } : { to };
}
