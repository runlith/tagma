import type { Tree } from '@runlith/code-facts/tree';
import { matchesGlob, posix } from 'node:path';
import type { ReadingScope } from './reading';

type Files = { readonly extensions: readonly string[]; readonly exclude: readonly string[] };

export const prefixOf = (base: string): string => (base === '' ? '' : `${base}/`);

export const localOf = (base: string, path: string): string | undefined => {
  const prefix = prefixOf(base);
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
};

export const picks = (files: Files, local: string): boolean =>
  files.extensions.some((extension) => local.endsWith(extension)) && !files.exclude.some((pattern) => matchesGlob(local, pattern));

const literal = (path: string): string => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&');

export const resolvedGlobs = (file: string, patterns: readonly string[], root?: string): readonly string[] | undefined => {
  const resolved: string[] = [];
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const written = negated ? pattern.slice(1) : pattern;
    const at = /^\.\.?\//.test(written)
      ? posix.join(literal(posix.dirname(file)), written)
      : written.startsWith('/') && root !== undefined
        ? posix.join(literal(root), written.slice(1))
        : undefined;
    if (at === undefined) return undefined;
    resolved.push(`${negated ? '!' : ''}${at}`);
  }
  return resolved;
};

export const globRoot = (pattern: string): string => {
  const first = pattern.search(/[*?[{!+@()]/);
  const prefix = first === -1 ? pattern : pattern.slice(0, first);
  return prefix.slice(0, Math.max(0, prefix.lastIndexOf('/')));
};

export const globPaths = (
  under: (root: string) => Iterable<string>,
  patterns: readonly string[],
  spend: (units: number) => void,
): readonly string[] => {
  const positive = patterns.filter((one) => !one.startsWith('!'));
  const negative = patterns.filter((one) => one.startsWith('!')).map((one) => one.slice(1));
  const candidates = new Set<string>();
  for (const root of new Set(positive.map(globRoot))) {
    for (const path of under(root)) {
      spend(1);
      candidates.add(path);
    }
  }
  return [...candidates].filter(
    (path) => positive.some((pattern) => matchesGlob(path, pattern)) && !negative.some((pattern) => matchesGlob(path, pattern)),
  );
};

export const mentionedIn = (
  tree: Tree,
  paths: readonly string[],
  words: readonly string[],
  scope: ReadingScope,
): ReadonlySet<string> | undefined => {
  if (scope === 'change') return new Set(paths.filter((path) => words.some((word) => tree.read(path).includes(word))));
  return tree.mentions?.(words);
};
