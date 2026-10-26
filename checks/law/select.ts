import type { Tree } from '@runlith/code-facts/tree';
import { matchesGlob } from 'node:path';
import type { ReadingScope } from '@tagma/inspection/node/reading';

type Files = { readonly extensions: readonly string[]; readonly exclude: readonly string[] };

export const prefixOf = (base: string): string => (base === '' ? '' : `${base}/`);

export const localOf = (base: string, path: string): string | undefined => {
  const prefix = prefixOf(base);
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
};

export const picks = (files: Files, local: string): boolean =>
  files.extensions.some((extension) => local.endsWith(extension)) && !files.exclude.some((pattern) => matchesGlob(local, pattern));

export const mentionedIn = (
  tree: Tree,
  paths: readonly string[],
  words: readonly string[],
  scope: ReadingScope,
): ReadonlySet<string> | undefined => {
  if (scope === 'change') return new Set(paths.filter((path) => words.some((word) => tree.read(path).includes(word))));
  return tree.mentions?.(words);
};
