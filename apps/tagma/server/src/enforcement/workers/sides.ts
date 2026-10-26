import type { Facet } from '@runlith/code-facts/adapter';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { BlobText } from '@runlith/code-facts/blobs';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import { facetOf, importsOf, pathsUnder, sitesOf, type Tree, type TreeChange } from '@runlith/code-facts/tree';
import { blobsAt } from '@runlith/git/entries';
import type { Git } from '@runlith/git/Git';
import { pointedTreeAt, type SortedPaths, treeDirectoriesAt, treeMentionsAt, type TreeListing } from '@runlith/git/trees';
import { Effect } from 'effect';
import { matchesGlob } from 'node:path';
import { gitUnread, Unread } from './unread.js';

export type Side = {
  readonly commit: string;
  readonly tree: string;
  readonly slot: string;
  readonly listed: TreeListing;
  readonly parts: readonly string[];
  readonly paths: readonly string[];
  readonly change?: TreeChange;
  readonly lookedUp?: Set<string>;
  readonly unknown?: Set<string>;
  readonly matched?: Map<string, readonly string[]>;
  readonly unmatched?: Map<string, readonly string[]>;
};

const MAGIC = /[*?[\]{}()!+@\\]/;
const POINTED_PER_CALL = 256;

const literalPrefixesOf = (globs: readonly string[]): readonly string[] => {
  const prefixes = new Set<string>();
  for (const glob of globs) {
    const literal: string[] = [];
    let outside = false;
    for (const segment of glob.split('/')) {
      if (MAGIC.test(segment)) break;
      if (segment === '..') {
        outside = true;
        break;
      }
      if (segment !== '' && segment !== '.') literal.push(segment);
    }
    if (!outside) prefixes.add(literal.join('/'));
  }
  return prefixes.has('') ? [''] : [...prefixes].sort();
};

export class GrowingPaths implements SortedPaths {
  private readonly held: string[] = [];
  private sorted = true;
  get size(): number {
    return this.held.length;
  }
  add(path: string): void {
    this.held.push(path);
    this.sorted = false;
  }
  private ordered(): readonly string[] {
    if (!this.sorted) {
      this.held.sort();
      this.sorted = true;
    }
    return this.held;
  }
  [Symbol.iterator](): Iterator<string> {
    return this.ordered()[Symbol.iterator]();
  }
  under(prefix: string): Iterable<string> {
    return pathsUnder(this.ordered(), prefix);
  }
}

export const pointInto = Effect.fn('inspecting.pointInto')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  side: Side,
  paths: readonly string[],
) {
  if (paths.length === 0) return false;
  if (side.lookedUp === undefined) return yield* new Unread({ cause: 'source', reason: 'a point lookup needs an isolated tree listing' });
  const found = yield* pointedTreeAt(git, root, tree, paths).pipe(Effect.mapError(gitUnread));
  const objects = side.listed.objects as Map<string, string>;
  const sizes = side.listed.sizes as Map<string, number>;
  const ordered = side.listed.ordered as GrowingPaths;
  let added = false;
  for (const [path, object] of found.objects) {
    if (objects.has(path)) continue;
    objects.set(path, object);
    sizes.set(path, found.sizes.get(path) ?? 0);
    ordered.add(path);
    added = true;
  }
  for (const path of paths) side.lookedUp.add(path);
  return added;
});

export const matchInto = Effect.fn('inspecting.matchInto')(function* (
  git: Git['Service'],
  root: string,
  side: Side,
  key: string,
  globs: readonly string[],
) {
  const prefixes = literalPrefixesOf(globs);
  const directories = yield* treeDirectoriesAt(git, root, side.tree, prefixes).pipe(Effect.mapError(gitUnread));
  const candidates = directories.filter((dir) => globs.some((glob) => matchesGlob(dir, glob))).map((dir) => `${dir}/package.json`);
  for (let at = 0; at < candidates.length; at += POINTED_PER_CALL)
    yield* pointInto(git, root, side.tree, side, candidates.slice(at, at + POINTED_PER_CALL));
  side.matched?.set(
    key,
    candidates.filter((path) => side.listed.objects.has(path)),
  );
});

export const texts = Effect.fn('inspecting.texts')(function* (git: Git['Service'], root: string, sides: readonly Side[]) {
  const asked = new Map<string, { readonly tree: string; readonly path: string }>();
  for (const side of sides) {
    for (const path of side.paths) {
      const object = side.listed.objects.get(path);
      if (object !== undefined && !asked.has(object)) asked.set(object, { tree: side.commit, path });
    }
  }
  const objects = [...asked.keys()];
  yield* Effect.annotateCurrentSpan('files', objects.length);
  const reads = yield* blobsAt(git, root, [...asked.values()]).pipe(Effect.mapError(gitUnread));
  const held = new Map<string, string>();
  const unread = new Map<string, string>();
  reads.forEach((read, at) => {
    const object = objects[at];
    if (object === undefined) return;
    if (read.status === 'text') held.set(object, read.text);
    else unread.set(object, read.status === 'unread' ? read.reason : 'git answered no such blob');
  });
  return { held, unread };
});

export const mentioned = Effect.fn('inspecting.mentioned')(function* (
  git: Git['Service'],
  root: string,
  side: Side,
  words: readonly string[],
) {
  return yield* treeMentionsAt(git, root, side.commit, side.parts, words).pipe(Effect.mapError(gitUnread));
});

export const fetchedBlobs = (sides: readonly Side[], held: ReadonlyMap<string, string>): BlobText[] =>
  sides.flatMap((side) =>
    side.paths.flatMap((path) => {
      const object = side.listed.objects.get(path);
      const text = object === undefined ? undefined : held.get(object);
      return object === undefined || text === undefined ? [] : [{ object, path, text }];
    }),
  );

export type Working = { readonly texts: ReadonlyMap<string, string | null>; readonly asked: Set<string> };

export class WorkingUnread extends Error {
  constructor(readonly path: string) {
    super(`the checkout's ${path} is read before the inspection runs again`);
    this.name = 'WorkingUnread';
  }
}

export const sideTree = (
  tree: Tree,
  touched: Set<string>,
  side: Side,
  words: Map<string, ReadonlySet<string>>,
  wanted: Map<string, readonly string[]>,
  unread: ReadonlyMap<string, string>,
  working?: Working,
): Tree => {
  const note = (path: string): void => {
    if (side.unknown !== undefined && side.lookedUp !== undefined && !side.listed.objects.has(path) && !side.lookedUp.has(path))
      side.unknown.add(path);
  };
  return {
    snapshot: side.tree,
    slot: side.slot,
    change: side.change,
    object: (path) => {
      touched.add(path);
      note(path);
      return side.listed.objects.get(path);
    },
    sites: (path) => {
      touched.add(path);
      note(path);
      const reason = unread.get(side.listed.objects.get(path) ?? '');
      if (reason !== undefined) throw new UnsupportedSource(path, reason);
      return sitesOf(tree, path, ADAPTERS);
    },
    has: (path) => {
      if (tree.has(path)) return true;
      note(path);
      return false;
    },
    paths: (prefix?: string) => side.listed.ordered.under(prefix ?? ''),
    matching:
      side.matched === undefined
        ? undefined
        : (globs: readonly string[]) => {
            const key = JSON.stringify(globs);
            const held = side.matched?.get(key);
            if (held !== undefined) return held;
            side.unmatched?.set(key, globs);
            return [];
          },
    read: (path) => {
      touched.add(path);
      note(path);
      const reason = unread.get(side.listed.objects.get(path) ?? '');
      if (reason !== undefined) throw new UnsupportedSource(path, reason);
      return tree.read(path);
    },
    imports: (path, reads) => {
      touched.add(path);
      note(path);
      return importsOf(tree, path, reads, ADAPTERS);
    },
    facet: <T>(path: string, facet: Facet<T>): T => {
      touched.add(path);
      note(path);
      return facetOf(tree, path, facet, ADAPTERS);
    },
    size: (path) => {
      note(path);
      return side.listed.sizes.get(path);
    },
    mentions: (terms) => {
      const key = JSON.stringify(terms);
      const known = words.get(key);
      if (known === undefined) wanted.set(key, terms);
      return known;
    },
    working:
      working === undefined
        ? undefined
        : (path) => {
            if (tree.has(path)) return undefined;
            if (!working.texts.has(path)) {
              working.asked.add(path);
              throw new WorkingUnread(path);
            }
            return working.texts.get(path) ?? undefined;
          },
  };
};
