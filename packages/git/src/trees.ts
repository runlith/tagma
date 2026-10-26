import { Effect } from 'effect';
import type { Git } from './Git.js';
import { GitUnreadable, commandFor, literal, runEnded, type GitAnswerInvalid, type GitRefused } from './repository.js';

type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;
export type SortedPaths = Iterable<string> & { readonly size: number; readonly under: (prefix: string) => Iterable<string> };
export type TreeListing = {
  readonly objects: ReadonlyMap<string, string>;
  readonly sizes: ReadonlyMap<string, number>;
  readonly ordered: SortedPaths;
};
export type TreeDifference = {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly mode: string | null;
  readonly status: string;
};
export type ListedChange = { readonly path: string; readonly object: string | null; readonly size: number };

const CHUNK = 256;
const FAN = 64;

type Chunk = {
  readonly paths: readonly string[];
  readonly objects: ReadonlyMap<string, string>;
  readonly sizes: ReadonlyMap<string, number>;
};
type Group = { readonly chunks: readonly Chunk[]; readonly firsts: readonly string[] };

const groupOf = (chunks: readonly Chunk[]): Group => ({ chunks, firsts: chunks.map((chunk) => chunk.paths[0]!) });

const cut = <T>(items: readonly T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
};

const chunkOf = (paths: readonly string[], objects: ReadonlyMap<string, string>, sizes: ReadonlyMap<string, number>): Chunk => ({
  paths,
  objects: new Map(paths.map((path) => [path, objects.get(path)!])),
  sizes: new Map(paths.map((path) => [path, sizes.get(path) ?? 0])),
});

const firstAbove = (sorted: readonly string[], target: string): number => {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
};

const firstAtLeast = (sorted: readonly string[], target: string): number => {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
};

class ChunkedView<V> implements ReadonlyMap<string, V> {
  constructor(
    private readonly listing: ChunkedListing,
    private readonly of: (chunk: Chunk) => ReadonlyMap<string, V>,
  ) {}
  get size(): number {
    return this.listing.ordered.size;
  }
  get(key: string): V | undefined {
    const chunk = this.listing.chunkFor(key);
    return chunk === undefined ? undefined : this.of(chunk).get(key);
  }
  has(key: string): boolean {
    const chunk = this.listing.chunkFor(key);
    return chunk !== undefined && this.of(chunk).has(key);
  }
  *entries(): MapIterator<[string, V]> {
    for (const chunk of this.listing.chunks) for (const path of chunk.paths) yield [path, this.of(chunk).get(path)!];
  }
  *keys(): MapIterator<string> {
    for (const [key] of this.entries()) yield key;
  }
  *values(): MapIterator<V> {
    for (const [, value] of this.entries()) yield value;
  }
  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }
  forEach(each: (value: V, key: string, map: ReadonlyMap<string, V>) => void): void {
    for (const [key, value] of this.entries()) each(value, key, this);
  }
}

export class ChunkedListing implements TreeListing {
  readonly objects: ReadonlyMap<string, string> = new ChunkedView(this, (chunk) => chunk.objects);
  readonly sizes: ReadonlyMap<string, number> = new ChunkedView(this, (chunk) => chunk.sizes);
  readonly ordered: SortedPaths;

  private constructor(
    private readonly groups: readonly Group[],
    private readonly firsts: readonly string[],
    count: number,
  ) {
    const listing = this;
    this.ordered = {
      size: count,
      [Symbol.iterator]: function* () {
        for (const chunk of listing.chunks) yield* chunk.paths;
      },
      under: (prefix) => listing.under(prefix),
    };
  }

  static of(objects: ReadonlyMap<string, string>, sizes: ReadonlyMap<string, number>): ChunkedListing {
    const sorted = [...objects.keys()].sort();
    const groups = cut(
      cut(sorted, CHUNK).map((paths) => chunkOf(paths, objects, sizes)),
      FAN,
    ).map(groupOf);
    return new ChunkedListing(
      groups,
      groups.map((group) => group.firsts[0]!),
      sorted.length,
    );
  }

  get chunks(): Iterable<Chunk> & { readonly includes: (chunk: Chunk) => boolean } {
    const groups = this.groups;
    return {
      [Symbol.iterator]: function* () {
        for (const group of groups) yield* group.chunks;
      },
      includes: (chunk) => groups.some((group) => group.chunks.includes(chunk)),
    };
  }

  chunkFor(path: string): Chunk | undefined {
    const group = this.groups[firstAbove(this.firsts, path) - 1];
    return group === undefined ? undefined : group.chunks[firstAbove(group.firsts, path) - 1];
  }

  with(changes: readonly ListedChange[]): ChunkedListing {
    if (changes.length === 0) return this;
    const touched = new Map<number, Map<number, ListedChange[]>>();
    for (const change of changes) {
      const at = Math.max(0, firstAbove(this.firsts, change.path) - 1);
      const group = this.groups[at];
      const chunkAt = group === undefined ? 0 : Math.max(0, firstAbove(group.firsts, change.path) - 1);
      let chunks = touched.get(at);
      if (chunks === undefined) touched.set(at, (chunks = new Map()));
      const held = chunks.get(chunkAt);
      if (held === undefined) chunks.set(chunkAt, [change]);
      else held.push(change);
    }
    const groups: Group[] = [];
    let count = this.ordered.size;
    for (let at = 0; at < Math.max(this.groups.length, 1); at += 1) {
      const group = this.groups[at];
      const moved = touched.get(at);
      if (moved === undefined) {
        if (group !== undefined) groups.push(group);
        continue;
      }
      const chunks: Chunk[] = [];
      for (let chunkAt = 0; chunkAt < Math.max(group?.chunks.length ?? 0, 1); chunkAt += 1) {
        const chunk = group?.chunks[chunkAt];
        const changed = moved.get(chunkAt);
        if (changed === undefined) {
          if (chunk !== undefined) chunks.push(chunk);
          continue;
        }
        const objects = new Map(chunk?.objects ?? []),
          sizes = new Map(chunk?.sizes ?? []);
        for (const { path, object, size } of changed) {
          count += (object === null ? 0 : 1) - (objects.has(path) ? 1 : 0);
          if (object === null) {
            objects.delete(path);
            sizes.delete(path);
          } else {
            objects.set(path, object);
            sizes.set(path, size);
          }
        }
        for (const paths of cut([...objects.keys()].sort(), CHUNK)) chunks.push(chunkOf(paths, objects, sizes));
      }
      for (const part of cut(chunks, FAN)) groups.push(groupOf(part));
    }
    return new ChunkedListing(
      groups,
      groups.map((group) => group.firsts[0]!),
      count,
    );
  }

  private *under(prefix: string): Iterable<string> {
    if (prefix === '') {
      yield* this.ordered;
      return;
    }
    const directory = `${prefix}/`;
    if (this.objects.has(prefix)) yield prefix;
    const start = Math.max(0, firstAbove(this.firsts, directory) - 1);
    for (let at = start; at < this.groups.length; at += 1) {
      const group = this.groups[at]!;
      for (
        let chunkAt = at === start ? Math.max(0, firstAbove(group.firsts, directory) - 1) : 0;
        chunkAt < group.chunks.length;
        chunkAt += 1
      ) {
        const paths = group.chunks[chunkAt]!.paths;
        for (let index = firstAtLeast(paths, directory); index < paths.length; index += 1) {
          if (!paths[index]!.startsWith(directory)) return;
          yield paths[index]!;
        }
      }
    }
  }
}

const OBJECT_NAME = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const NULL_OBJECT = /^0+$/;
const LISTED = /^\d+ (\w+) ([0-9a-f]+) +(-|\d+)$/;
const TREE_LISTED = /^\d+ tree [0-9a-f]+$/;
const pathspecs = (parts: readonly string[]): readonly string[] => (parts.includes('') ? [] : ['--', ...parts.map(literal)]);

const invalid = (dir: string, args: readonly string[], reason: string): GitUnreadable =>
  new GitUnreadable({ command: commandFor(dir, args), reason });

export const parseDiffTreeZero = (stdout: string): TreeDifference[] => {
  const parts = stdout.split('\0');
  const entries: TreeDifference[] = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const info = parts[at] ?? '';
    const path = parts[at + 1] ?? '';
    if (path === '' || !info.startsWith(':')) continue;
    const fields = info.split(' ');
    if (fields.length < 5) continue;
    const before = fields[2] ?? '';
    const after = fields[3] ?? '';
    const mode = fields[1] ?? '';
    entries.push({
      path,
      before: before === '' || NULL_OBJECT.test(before) ? null : before,
      after: after === '' || NULL_OBJECT.test(after) ? null : after,
      mode: /^0+$/.test(mode) || mode === '' ? null : mode,
      status: fields[4] ?? '',
    });
  }
  return entries;
};

export const parseTreeIds = (stdout: string): { readonly baseTree: string; readonly builtTree: string } | undefined => {
  const lines = stdout.trim().split('\n');
  if (lines.length !== 2) return undefined;
  const baseTree = lines[0] ?? '';
  const builtTree = lines[1] ?? '';
  return OBJECT_NAME.test(baseTree) && OBJECT_NAME.test(builtTree) ? { baseTree, builtTree } : undefined;
};

export const treePresentAt = Effect.fn('Git.treePresent')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
): Effect.fn.Return<boolean, GitFailure> {
  const args = ['cat-file', '--batch-check=%(objecttype)', '-Z'];
  if (!OBJECT_NAME.test(tree)) return yield* invalid(root, args, 'a tree id is not an object name');
  const answer = yield* runEnded(git, root, args, undefined, [], { stdin: `${tree}\0` });
  if (answer.stdout === 'tree\0') return true;
  if (answer.stdout === `${tree} missing\0`) return false;
  return yield* invalid(root, args, `git cat-file returned invalid tree metadata: ${answer.stdout}`);
});

export const treeIdAt = Effect.fn('Git.treeId')(function* (
  git: Git['Service'],
  root: string,
  commit: string,
): Effect.fn.Return<string, GitFailure> {
  const args = ['rev-parse', '--verify', `${commit}^{tree}`];
  const answer = yield* runEnded(git, root, args, undefined, []);
  const id = answer.stdout.trim().split('\n')[0] ?? '';
  if (!OBJECT_NAME.test(id)) return yield* invalid(root, args, `git rev-parse returned an invalid tree: ${id}`);
  return id;
});

export const treeIdsAt = Effect.fn('Git.treeIds')(function* (
  git: Git['Service'],
  root: string,
  base: string,
  built: string,
): Effect.fn.Return<{ readonly baseTree: string; readonly builtTree: string }, GitFailure> {
  if (base === built) {
    const tree = yield* treeIdAt(git, root, base);
    return { baseTree: tree, builtTree: tree };
  }
  const args = ['rev-parse', `${base}^{tree}`, `${built}^{tree}`];
  const answer = yield* runEnded(git, root, args, undefined, []);
  const ids = parseTreeIds(answer.stdout);
  if (ids === undefined) return yield* invalid(root, args, 'git rev-parse returned invalid tree names');
  return ids;
});

export const diffTreeAt = Effect.fn('Git.diffTree')(function* (
  git: Git['Service'],
  root: string,
  from: string,
  to: string,
): Effect.fn.Return<readonly TreeDifference[], GitFailure> {
  const answer = yield* runEnded(git, root, ['diff-tree', '-r', '-z', '--no-renames', '--end-of-options', from, to], undefined, []);
  return parseDiffTreeZero(answer.stdout);
});

export type CommitPair = { readonly from: string; readonly to: string };

export const diffCommitsAt = Effect.fn('Git.diffCommits')(function* (
  git: Git['Service'],
  root: string,
  pairs: readonly CommitPair[],
): Effect.fn.Return<readonly (readonly TreeDifference[])[], GitFailure> {
  if (pairs.length === 0) return [];
  const args = ['diff-tree', '--stdin', '--always', '-r', '-z', '--no-renames'];
  const named = pairs.find(({ from, to }) => !OBJECT_NAME.test(from) || !OBJECT_NAME.test(to));
  if (named !== undefined)
    return yield* invalid(root, args, `git diff-tree --stdin reads object names only, not ${named.to} ${named.from}`);
  const stdin = pairs.map(({ from, to }) => `${to} ${from}\n`).join('');
  const answer = yield* runEnded(git, root, args, undefined, [], { stdin });
  const groups: string[][] = [];
  const parts = answer.stdout.split('\0');
  for (let at = 0; at < parts.length; at += 1) {
    const part = parts[at] ?? '';
    if (part.startsWith(':')) {
      groups.at(-1)?.push(part, parts[at + 1] ?? '');
      at += 1;
    } else if (part !== '') {
      if (part !== pairs[groups.length]?.to)
        return yield* invalid(root, args, `git diff-tree answered ${part} where it was asked for ${pairs[groups.length]?.to}`);
      groups.push([]);
    }
  }
  if (groups.length !== pairs.length)
    return yield* invalid(root, args, `git diff-tree answered ${groups.length} of ${pairs.length} commits`);
  return groups.map((group) => parseDiffTreeZero(group.join('\0')));
});

const parseListed = (stdout: string, kind: 'blob' | 'tree') => {
  const objects = new Map<string, string>();
  const sizes = new Map<string, number>();
  for (const record of stdout.split('\0')) {
    const tab = record.indexOf('\t');
    const fields = tab === -1 ? null : LISTED.exec(record.slice(0, tab));
    if (fields === null || fields[1] !== kind || fields[2] === undefined) continue;
    const path = record.slice(tab + 1);
    objects.set(path, fields[2]);
    sizes.set(path, Number(fields[3]));
  }
  return { objects, sizes };
};

export const listedTreeAt = Effect.fn('Git.listedTree')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  parts: readonly string[],
): Effect.fn.Return<{ readonly listing: ChunkedListing; readonly bytes: number }, GitFailure> {
  const args = ['ls-tree', '-r', '-l', '-z', '--full-tree', '--end-of-options', tree, ...pathspecs(parts)];
  const answer = yield* runEnded(git, root, args, undefined, []);
  const { objects, sizes } = parseListed(answer.stdout, 'blob');
  return { listing: ChunkedListing.of(objects, sizes), bytes: Buffer.byteLength(answer.stdout) * 4 };
});

export const pointedTreeAt = Effect.fn('Git.pointedTree')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  paths: readonly string[],
): Effect.fn.Return<TreeListing, GitFailure> {
  if (paths.length === 0) return ChunkedListing.of(new Map(), new Map());
  const args = ['cat-file', '--batch-check', '-Z'];
  if (tree.includes('\0') || paths.some((path) => path.includes('\0')))
    return yield* invalid(root, args, 'a tree or path contains a NUL byte');
  const names = paths.map((path) => `${tree}:${path}`);
  const answer = yield* runEnded(git, root, args, undefined, [], { stdin: `${[tree, ...names].join('\0')}\0` });
  const records = answer.stdout.split('\0');
  if (records.pop() !== '' || records.length !== paths.length + 1)
    return yield* invalid(root, args, 'git cat-file returned another number of records than it was asked');
  const rootRecord = records.shift()!;
  const rootKind = /^[0-9a-f]{40}(?:[0-9a-f]{24})? (\w+) \d+$/.exec(rootRecord)?.[1];
  if (rootKind === 'commit' || rootKind === 'tag') return yield* pointedTreeAt(git, root, yield* treeIdAt(git, root, tree), paths);
  if (rootKind !== 'tree') return yield* invalid(root, args, `the tree could not be read: ${rootRecord}`);
  const objects = new Map<string, string>();
  const sizes = new Map<string, number>();
  for (const [at, path] of paths.entries()) {
    const record = records[at]!;
    if (record === `${names[at]} missing`) continue;
    const found = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\w+) (\d+)$/.exec(record);
    if (found === null) return yield* invalid(root, args, `git cat-file returned invalid object metadata: ${record}`);
    if (found[2] === 'blob') {
      objects.set(path, found[1]!);
      sizes.set(path, Number(found[3]));
    }
  }
  return ChunkedListing.of(objects, sizes);
});

export const treeDirectoriesAt = Effect.fn('Git.treeDirectories')(function* (
  git: Git['Service'],
  root: string,
  tree: string,
  prefixes: readonly string[],
): Effect.fn.Return<readonly string[], GitFailure> {
  if (prefixes.length === 0) return [];
  const answer = yield* runEnded(
    git,
    root,
    ['ls-tree', '-r', '-d', '-z', '--full-tree', '--end-of-options', tree, ...pathspecs(prefixes)],
    undefined,
    [],
  );
  return answer.stdout.split('\0').flatMap((record) => {
    const tab = record.indexOf('\t');
    return tab !== -1 && TREE_LISTED.test(record.slice(0, tab)) ? [record.slice(tab + 1)] : [];
  });
});

export const treeMentionsAt = Effect.fn('Git.treeMentions')(function* (
  git: Git['Service'],
  root: string,
  commit: string,
  parts: readonly string[],
  words: readonly string[],
): Effect.fn.Return<ReadonlySet<string>, GitFailure> {
  if (words.length === 0) return new Set<string>();
  const args = ['grep', '-l', '-z', '-F', '-w', ...words.flatMap((word) => ['-e', word]), '--end-of-options', commit, ...pathspecs(parts)];
  const answer = yield* runEnded(git, root, args, undefined, [1]);
  const found = new Set<string>();
  const prefix = `${commit}:`;
  for (const record of answer.stdout.split('\0')) if (record.startsWith(prefix)) found.add(record.slice(prefix.length));
  return found;
});
