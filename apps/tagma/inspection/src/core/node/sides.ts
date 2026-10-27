import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Facet } from '@runlith/code-facts/adapter';
import { blobTree, type FacetMemo, type ParseMemo } from '@runlith/code-facts/blobs';
import { UnsupportedSource } from '@runlith/code-facts/imports';
import {
  type Environment,
  facetOf,
  importsOf,
  type Installed,
  pathsUnder,
  sitesOf,
  type Tree,
  type TreeChange,
} from '@runlith/code-facts/tree';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { type Budget } from './budget';
import {
  commitGrep,
  commitListing,
  commitLoad,
  decoded,
  git,
  grepped,
  type Listed,
  pointListingOf,
  specs,
  treeIdOf,
  type Wanted,
  within,
} from './gitTrees';

export type Side = {
  readonly paths: readonly string[];
  readonly size: (path: string) => number | undefined;
  readonly tree: (missing: Set<string> | undefined) => Tree;
  readonly fetch: (paths: Iterable<string>, budget?: Budget) => void;
};

const ABSENT = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP']);

const checkoutFile = (real: string, path: string): Installed | undefined => {
  const at = join(real, path);
  try {
    const text = decoded(path, readFileSync(at));
    const lies = relative(real, realpathSync(at)).replaceAll('\\', '/');
    return { text, at: isAbsolute(lies) ? path : lies };
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && ABSENT.has(error.code)) return undefined;
    throw error;
  }
};

export const environmentOf = (repository: string): Environment => {
  const real = realpathSync(repository);
  const held = new Map<string, Installed | undefined>();
  return {
    depth: real.split(/[\\/]/).filter((part) => part !== '').length,
    read: (path) => {
      if (!held.has(path)) held.set(path, checkoutFile(real, path));
      return held.get(path);
    },
  };
};

export const withEnvironment = (environment: Environment, tree: Tree): Tree => ({
  ...tree,
  environment: { depth: environment.depth, read: (path) => (tree.has(path) ? undefined : environment.read(path)) },
});

export const withCheckout = (environment: Environment, tree: Tree): Tree => {
  const held = withEnvironment(environment, tree);
  return { ...held, working: (path) => held.environment?.read(path)?.text };
};

export type Seeded = {
  readonly asked: ReadonlySet<string>;
  readonly region: () => Listed;
};

export type Seed = Seeded & { readonly listed: Listed };

export const seedAt = (repository: string, tree: string, parts: readonly string[], paths: readonly string[]): Seed => ({
  asked: new Set(paths),
  listed: new Map([...pointListingOf(repository, tree, paths)].filter(([path]) => within(parts, path))),
  region: () => commitListing(repository, tree, parts),
});

const sideOf = (
  listed: Listed,
  load: (wanted: readonly { readonly path: string; readonly object: string }[]) => ReadonlyMap<string, string>,
  grep: (words: readonly string[]) => ReadonlySet<string>,
  parts: readonly string[],
  parses: ParseMemo,
  facts: FacetMemo,
  snapshot?: string,
  extra?: { readonly slot?: string; readonly change?: TreeChange },
  seed?: Seeded,
): Side => {
  const objects = new Map([...listed].map(([path, { object }]) => [path, object]));
  const texts = new Map<string, string>();
  const mentioned = new Map<string, ReadonlySet<string>>();
  let covered = seed === undefined;
  let sorted: readonly string[] | undefined;
  const cover = (): void => {
    if (covered) return;
    covered = true;
    for (const [path, entry] of (seed as Seeded).region()) {
      if (listed.has(path)) continue;
      listed.set(path, entry);
      objects.set(path, entry.object);
    }
    sorted = undefined;
  };
  const settle = (path: string): void => {
    if (covered || listed.has(path) || (seed as Seeded).asked.has(path)) return;
    cover();
  };
  const ordered = (): readonly string[] => (sorted ??= [...listed.keys()].sort());
  return {
    paths: ordered(),
    size: (path) => {
      settle(path);
      return listed.get(path)?.size;
    },
    fetch: (paths, budget) => {
      const wanted = [...paths].flatMap((path) => {
        const object = objects.get(path);
        return object === undefined || texts.has(object) ? [] : [{ path, object }];
      });
      for (const { path, object } of wanted) budget?.blob?.(object, listed.get(path)?.size ?? 0);
      for (const [object, text] of load(wanted)) texts.set(object, text);
    },
    tree: (missing) => {
      const held = blobTree(objects, texts, parses, ADAPTERS, missing, facts);
      return {
        ...held,
        snapshot,
        slot: extra?.slot,
        change: extra?.change,
        has: (path) => {
          settle(path);
          return held.has(path);
        },
        object: (path) => {
          settle(path);
          return held.object?.(path);
        },
        read: (path) => {
          settle(path);
          return held.read(path);
        },
        sites: (path) => {
          settle(path);
          return sitesOf(held, path, ADAPTERS);
        },
        imports: (path, reads) => {
          settle(path);
          return importsOf(held, path, reads, ADAPTERS);
        },
        facet: <T>(path: string, facet: Facet<T>): T => {
          settle(path);
          return facetOf(held, path, facet, ADAPTERS);
        },
        paths: (prefix?: string) => {
          cover();
          return pathsUnder(ordered(), prefix);
        },
        size: (path) => {
          settle(path);
          return listed.get(path)?.size;
        },
        mentions: (words) => {
          const key = words.join('\0');
          const known = mentioned.get(key);
          if (known !== undefined) return known;
          const found = new Set([...grep(words)].filter((path) => (seed === undefined ? listed.has(path) : within(parts, path))));
          mentioned.set(key, found);
          return found;
        },
      };
    },
  };
};

export const commitSideAt = (
  repository: string,
  tree: string,
  parts: readonly string[],
  parses: ParseMemo,
  facts: FacetMemo,
  extra?: { readonly slot?: string; readonly change?: TreeChange },
  seed?: Seed,
): Side =>
  sideOf(
    seed === undefined ? commitListing(repository, tree, parts) : new Map(seed.listed),
    commitLoad(repository),
    commitGrep(repository, tree, parts),
    parts,
    parses,
    facts,
    tree,
    { slot: repository, ...extra },
    seed,
  );

export const commitSide = (
  repository: string,
  commit: string,
  parts: readonly string[],
  parses: ParseMemo,
  facts: FacetMemo,
  extra?: { readonly change?: TreeChange },
  seed?: Seed,
): Side => commitSideAt(repository, treeIdOf(repository, commit), parts, parses, facts, extra, seed);

const WORD = /[A-Za-z0-9_]/;

const mentions = (text: string, word: string): boolean => {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!WORD.test(text[at - 1] ?? '') && !WORD.test(text[at + word.length] ?? '')) return true;
  }
  return false;
};

export type Named = ReadonlyMap<string, { readonly size: number } | null>;

export const overlaidSide = (
  committed: ReadonlyMap<string, { readonly object: string; readonly size: number }>,
  named: Named,
  parts: readonly string[],
  load: (wanted: Wanted) => ReadonlyMap<string, string>,
  read: (path: string) => string,
  grep: (words: readonly string[]) => ReadonlySet<string>,
  parses: ParseMemo,
  facts: FacetMemo,
  baseSnapshot?: string,
  extra?: { readonly slot?: string; readonly change?: TreeChange },
  region?: () => Listed,
): Side => {
  const listed: Listed = new Map(committed);
  const overlay = crypto.randomUUID();
  const written = new Map<string, string>();
  for (const [path, stat] of named) {
    if (!within(parts, path)) continue;
    if (stat === null) listed.delete(path);
    else {
      const object = `worktree\0${overlay}\0${path}`;
      listed.set(path, { object, size: stat.size });
      written.set(object, path);
    }
  }
  const readTexts = new Map<string, string>();
  const text = (object: string): string => {
    const held = readTexts.get(object);
    if (held !== undefined) return held;
    const fresh = read(written.get(object) as string);
    readTexts.set(object, fresh);
    return fresh;
  };
  const loadBoth = (wanted: Wanted) => {
    const texts = new Map(load(wanted.filter(({ object }) => !written.has(object))));
    for (const { object } of wanted) if (written.has(object)) texts.set(object, text(object));
    return texts;
  };
  const grepBoth = (words: readonly string[]) => {
    const found = new Set([...grep(words)].filter((path) => !named.has(path)));
    for (const [object, path] of written) {
      const held = text(object);
      if (words.some((word) => mentions(held, word))) found.add(path);
    }
    return found;
  };
  return sideOf(
    listed,
    loadBoth,
    grepBoth,
    parts,
    parses,
    facts,
    `${baseSnapshot ?? 'worktree'}\0${overlay}`,
    extra === undefined && baseSnapshot === undefined ? undefined : { ...extra },
    region === undefined ? undefined : { asked: new Set(named.keys()), region },
  );
};

export const pathsSide = (
  repository: string,
  tree: string,
  named: readonly string[],
  parts: readonly string[],
  parses: ParseMemo,
  facts: FacetMemo,
): Side => {
  const stats = new Map<string, { readonly size: number } | null>();
  for (const path of named) {
    try {
      const stat = statSync(join(repository, path));
      stats.set(path, stat.isFile() ? { size: stat.size } : null);
    } catch {
      stats.set(path, null);
    }
  }
  const read = (path: string) => decoded(path, readFileSync(join(repository, path)));
  return overlaidSide(
    pointListingOf(repository, tree, named),
    stats,
    parts,
    commitLoad(repository),
    read,
    commitGrep(repository, tree, parts),
    parses,
    facts,
    tree,
    { slot: repository },
    () => commitListing(repository, tree, parts),
  );
};

export const commitTree = (repository: string, commit: string, parts: readonly string[], parses: ParseMemo, facts: FacetMemo) => {
  const side = commitSide(repository, commit, parts, parses, facts);
  side.fetch(side.paths);
  return { tree: side.tree(undefined), paths: side.paths };
};

export const worktreeSide = (repository: string, parts: readonly string[], parses: ParseMemo, facts: FacetMemo): Side => {
  const listed = new Map<string, { readonly object: string; readonly size: number }>();
  for (const path of git(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...specs(parts)])
    .toString()
    .split('\0')) {
    if (path === '' || listed.has(path)) continue;
    try {
      const stat = statSync(join(repository, path));
      if (stat.isFile()) listed.set(path, { object: `${path}\0${stat.mtimeMs}\0${stat.size}`, size: stat.size });
    } catch {}
  }
  const load = (wanted: readonly { readonly path: string; readonly object: string }[]) =>
    new Map(wanted.map(({ path, object }) => [object, decoded(path, readFileSync(join(repository, path)))]));
  const grep = (words: readonly string[]) =>
    words.length === 0
      ? new Set<string>()
      : grepped(
          git(repository, ['grep', '--untracked', '-l', '-z', '-F', '-w', ...words.flatMap((word) => ['-e', word]), ...specs(parts)]),
          '',
        );
  return sideOf(listed, load, grep, parts, parses, facts);
};

export type LazySide = Side & {
  readonly drainUnknown: () => readonly string[];
  readonly fill: (queried: readonly string[], listed: Listed) => void;
};

export const lazyCommitSide = (
  repository: string,
  tree: string,
  seed: Listed,
  parts: readonly string[],
  parses: ParseMemo,
  facts: FacetMemo,
  extra: { readonly slot: string; readonly change?: TreeChange },
): LazySide => {
  const listed: Listed = new Map([...seed].filter(([path]) => within(parts, path)));
  const objects = new Map([...listed].map(([path, { object }]) => [path, object]));
  const texts = new Map<string, string>();
  const mentioned = new Map<string, ReadonlySet<string>>();
  const lookedUp = new Set<string>();
  const unknown = new Set<string>();
  for (const path of listed.keys()) lookedUp.add(path);
  const note = (path: string): void => {
    if (!objects.has(path) && !lookedUp.has(path)) unknown.add(path);
  };
  const load = commitLoad(repository);
  const grep = commitGrep(repository, tree, parts);
  const orderedOf = (): readonly string[] => [...listed.keys()].sort();
  const side: Side = {
    paths: orderedOf(),
    size: (path) => {
      note(path);
      return listed.get(path)?.size;
    },
    fetch: (paths, budget) => {
      const wanted = [...paths].flatMap((path) => {
        const object = objects.get(path);
        return object === undefined || texts.has(object) ? [] : [{ path, object }];
      });
      for (const { path, object } of wanted) budget?.blob?.(object, listed.get(path)?.size ?? 0);
      for (const [object, text] of load(wanted)) texts.set(object, text);
    },
    tree: (missing) => ({
      ...blobTree(objects, texts, parses, ADAPTERS, missing, facts),
      snapshot: tree,
      slot: extra.slot,
      change: extra.change,
      paths: (prefix?: string) => pathsUnder(orderedOf(), prefix),
      size: (path) => {
        note(path);
        return listed.get(path)?.size;
      },
      mentions: (words) => {
        const key = words.join('\0');
        const known = mentioned.get(key);
        if (known !== undefined) return known;
        const found = new Set([...grep(words)].filter((path) => within(parts, path)));
        mentioned.set(key, found);
        return found;
      },
      has: (path) => {
        if (objects.has(path)) return true;
        note(path);
        return false;
      },
      object: (path) => {
        const held = objects.get(path);
        if (held === undefined) note(path);
        return held;
      },
      read: (path) => {
        if (!objects.has(path)) note(path);
        const object = objects.get(path);
        const text = object === undefined ? undefined : texts.get(object);
        if (text !== undefined) return text;
        if (missing !== undefined && objects.has(path)) {
          missing.add(path);
          return '';
        }
        if (missing !== undefined) return '';
        throw new UnsupportedSource(path, `no text was read for ${object ?? 'a path the tree does not list'}`);
      },
    }),
  };
  return {
    ...side,
    paths: side.paths,
    drainUnknown: () => {
      const paths = [...unknown];
      unknown.clear();
      return paths;
    },
    fill: (queried, incoming) => {
      for (const path of queried) lookedUp.add(path);
      for (const [path, entry] of incoming) {
        if (!within(parts, path)) continue;
        listed.set(path, entry);
        objects.set(path, entry.object);
        lookedUp.add(path);
      }
    },
  };
};
