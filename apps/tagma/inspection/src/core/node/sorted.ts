const LEAF = 256;
const FAN = 64;

type Leaf = readonly string[];
type Group = { readonly leaves: readonly Leaf[]; readonly firsts: readonly string[]; readonly size: number };

const above = (sorted: readonly string[], target: string): number => {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
};

const atLeast = (sorted: readonly string[], target: string): number => {
  let low = 0,
    high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
};

const cut = <T>(items: readonly T[], size: number): T[][] => {
  const parts: T[][] = [];
  for (let at = 0; at < items.length; at += size) parts.push(items.slice(at, at + size));
  return parts;
};

const groupOf = (leaves: readonly Leaf[]): Group => ({
  leaves,
  firsts: leaves.map((leaf) => leaf[0]!),
  size: leaves.reduce((sum, leaf) => sum + leaf.length, 0),
});

export class SortedPaths implements Iterable<string> {
  private constructor(
    private readonly groups: readonly Group[],
    private readonly firsts: readonly string[],
    readonly size: number,
  ) {}

  static of(paths: Iterable<string>): SortedPaths {
    const sorted = [...paths].sort();
    const groups = cut(cut(sorted, LEAF), FAN).map(groupOf);
    return new SortedPaths(
      groups,
      groups.map((group) => group.firsts[0]!),
      sorted.length,
    );
  }

  has(path: string): boolean {
    const group = this.groups[above(this.firsts, path) - 1];
    if (group === undefined) return false;
    const leaf = group.leaves[above(group.firsts, path) - 1];
    return leaf !== undefined && leaf[atLeast(leaf, path)] === path;
  }

  with(added: Iterable<string>, removed: ReadonlySet<string>): SortedPaths {
    const touched = new Map<number, Map<number, { add: string[]; drop: boolean }>>();
    const touch = (path: string, add: boolean): void => {
      const at = Math.max(0, above(this.firsts, path) - 1);
      const group = this.groups[at];
      const leafAt = group === undefined ? 0 : Math.max(0, above(group.firsts, path) - 1);
      let leaves = touched.get(at);
      if (leaves === undefined) touched.set(at, (leaves = new Map()));
      let held = leaves.get(leafAt);
      if (held === undefined) leaves.set(leafAt, (held = { add: [], drop: false }));
      if (add) held.add.push(path);
      else held.drop = true;
    };
    for (const path of added) if (!this.has(path)) touch(path, true);
    for (const path of removed) if (this.has(path)) touch(path, false);
    if (touched.size === 0) return this;
    const groups: Group[] = [];
    let size = 0;
    const count = Math.max(this.groups.length, 1);
    for (let at = 0; at < count; at += 1) {
      const group = this.groups[at];
      const leavesTouched = touched.get(at);
      if (leavesTouched === undefined) {
        if (group !== undefined) {
          groups.push(group);
          size += group.size;
        }
        continue;
      }
      const leaves: Leaf[] = [];
      const leafCount = Math.max(group?.leaves.length ?? 0, 1);
      for (let leafAt = 0; leafAt < leafCount; leafAt += 1) {
        const leaf = group?.leaves[leafAt] ?? [];
        const change = leavesTouched.get(leafAt);
        if (change === undefined) {
          leaves.push(leaf);
          continue;
        }
        const kept = change.drop ? leaf.filter((path) => !removed.has(path)) : [...leaf];
        const next = change.add.length === 0 ? kept : [...kept, ...change.add].sort();
        leaves.push(...cut(next, LEAF));
      }
      for (const part of cut(
        leaves.filter((leaf) => leaf.length > 0),
        FAN,
      )) {
        const made = groupOf(part);
        groups.push(made);
        size += made.size;
      }
    }
    return new SortedPaths(
      groups,
      groups.map((group) => group.firsts[0]!),
      size,
    );
  }

  *under(prefix: string): Iterable<string> {
    if (prefix === '') {
      yield* this;
      return;
    }
    const root = prefix.replace(/\/$/, '');
    if (this.has(root)) yield root;
    const directory = `${root}/`;
    for (let at = Math.max(0, above(this.firsts, directory) - 1); at < this.groups.length; at += 1) {
      const group = this.groups[at]!;
      for (
        let leafAt = at === Math.max(0, above(this.firsts, directory) - 1) ? Math.max(0, above(group.firsts, directory) - 1) : 0;
        leafAt < group.leaves.length;
        leafAt += 1
      ) {
        const leaf = group.leaves[leafAt]!;
        for (let index = atLeast(leaf, directory); index < leaf.length; index += 1) {
          if (!leaf[index]!.startsWith(directory)) return;
          yield leaf[index]!;
        }
      }
    }
  }

  *[Symbol.iterator](): Iterator<string> {
    for (const group of this.groups) for (const leaf of group.leaves) yield* leaf;
  }
}

const LAYERS = 32;

export class Layered<V> implements ReadonlyMap<string, V> {
  private constructor(
    private readonly below: Layered<V> | ReadonlyMap<string, V>,
    private readonly patch: ReadonlyMap<string, V | undefined>,
    private readonly depth: number,
    readonly size: number,
  ) {}

  static of<V>(base: ReadonlyMap<string, V>): Layered<V> {
    return base instanceof Layered ? (base as Layered<V>) : new Layered(base, new Map(), 0, base.size);
  }

  with(changes: ReadonlyMap<string, V | undefined>): Layered<V> {
    if (changes.size === 0) return this;
    let size = this.size;
    for (const [key, value] of changes) size += (value === undefined ? 0 : 1) - (this.has(key) ? 1 : 0);
    const next = new Layered<V>(this, changes, this.depth + 1, size);
    return next.depth < LAYERS ? next : new Layered(new Map(next.entries()), new Map(), 0, size);
  }

  get(key: string): V | undefined {
    let at: Layered<V> | ReadonlyMap<string, V> = this;
    while (at instanceof Layered) {
      if (at.patch.has(key)) return at.patch.get(key);
      at = at.below;
    }
    return at.get(key);
  }
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }
  *entries(): MapIterator<[string, V]> {
    const seen = new Set<string>();
    let at: Layered<V> | ReadonlyMap<string, V> = this;
    while (at instanceof Layered) {
      for (const [key, value] of at.patch) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (value !== undefined) yield [key, value];
      }
      at = at.below;
    }
    for (const [key, value] of at) if (!seen.has(key)) yield [key, value];
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
