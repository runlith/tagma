import { fold, terms } from '@runlith/search-text/match';
import type { FoundFile } from '../contract/wire/paths.js';
import { matchPath } from './score.js';

export const makePathSet = () => {
  let paths = new Map<string, string>();

  return {
    load: (held: readonly string[]): void => void (paths = new Map(held.map((path) => [path, fold(path)]))),

    patch: (scanned: readonly string[], found: readonly string[]): void => {
      const standing = new Set(found);
      const prefixes: string[] = [];
      for (const place of scanned) {
        if (standing.has(place) || paths.delete(place)) continue;
        prefixes.push(`${place}/`);
      }
      if (prefixes.length > 0) {
        for (const path of paths.keys()) {
          if (!standing.has(path) && prefixes.some((prefix) => path.startsWith(prefix))) paths.delete(path);
        }
      }
      for (const path of found) if (!paths.has(path)) paths.set(path, fold(path));
    },

    find: (query: string, limit: number, recent: readonly string[]): { readonly files: readonly FoundFile[]; readonly matched: number } => {
      const words = terms(query);
      if (words.length === 0) {
        const held = recent.filter((path) => paths.has(path));
        return { files: held.slice(0, limit).map((path) => ({ path, positions: [] })), matched: held.length };
      }
      const rank = new Map(recent.map((path, index) => [path, index] as const));
      const hits: { readonly path: string; readonly score: number; readonly positions: readonly number[] }[] = [];
      for (const [path, folded] of paths) {
        const match = matchPath(words, path, folded, rank.get(path) ?? -1);
        if (match !== null) hits.push({ path, ...match });
      }
      hits.sort((left, right) => right.score - left.score || left.path.length - right.path.length || (left.path < right.path ? -1 : 1));
      return {
        files: hits.slice(0, limit).map(({ path, positions }) => ({ path, positions })),
        matched: hits.length,
      };
    },
  };
};

export type PathSet = ReturnType<typeof makePathSet>;
