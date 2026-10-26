export type ImportReads = 'from' | 'static' | 'runtime' | 'every' | 'forwards';

export type ImportSite = {
  readonly specifier: string;
  readonly line: number;
  readonly clause: boolean;
  readonly loads: 'with-module' | 'lazily' | 'never';
  readonly forwards: boolean;
  readonly form?: 'import' | 'require';
  readonly kind?: 'worker' | 'glob' | 'unresolved';
  readonly patterns?: readonly string[];
};

export type ParsedImport = { readonly specifier: string; readonly line: number };

export type ImportEdge = {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly to: string;
};

export class UnsupportedSource extends Error {
  constructor(
    readonly path: string,
    readonly why: string,
  ) {
    super(`${path}: ${why}`);
    this.name = 'UnsupportedSource';
  }
}

export class InputAbsent extends UnsupportedSource {
  constructor(
    path: string,
    readonly absent: string,
    why: string,
  ) {
    super(path, why);
    this.name = 'InputAbsent';
  }
}

export class CopyStale extends UnsupportedSource {
  constructor(
    path: string,
    readonly output: string,
    why: string,
  ) {
    super(path, why);
    this.name = 'CopyStale';
  }
}

export class UnsupportedLanguage extends UnsupportedSource {
  constructor(path: string, why: string) {
    super(path, why);
    this.name = 'UnsupportedLanguage';
  }
}

export const COUNTS: { readonly [K in ImportReads]: (site: ImportSite) => boolean } = {
  from: (site) => site.clause,
  static: (site) => site.loads === 'with-module',
  runtime: (site) => site.loads !== 'never',
  every: () => true,
  forwards: (site) => site.forwards,
};

export const readOf = (sites: readonly ImportSite[], reads: ImportReads): readonly ParsedImport[] =>
  sites.filter((site) => site.kind === undefined && COUNTS[reads](site)).map(({ specifier, line }) => ({ specifier, line }));

export type ImportClosure = {
  readonly root: string;
  readonly reached: ReadonlySet<string>;
  readonly forward: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reverse: ReadonlyMap<string, ReadonlySet<string>>;
};

export type ClosureDiff = {
  readonly reached: ReadonlySet<string>;
  readonly added: readonly string[];
  readonly removed: readonly string[];
};

type MutableClosure = {
  readonly root: string;
  readonly reached: Set<string>;
  readonly forward: Map<string, Set<string>>;
  readonly reverse: Map<string, Set<string>>;
};

const NO_OUTGOING: ReadonlySet<string> = new Set();

export function createImportClosure(root: string, edges: readonly ImportEdge[]): ImportClosure {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  for (const edge of edges) linkEdge(forward, reverse, edge.file, edge.to);
  return { root, reached: reachableFrom(forward, root), forward, reverse };
}

export function updateImportClosure(closure: ImportClosure, touched: ReadonlyMap<string, readonly string[]>): ClosureDiff {
  const mutable = closure as MutableClosure;
  const changed: { readonly file: string; readonly prev: ReadonlySet<string>; readonly next: readonly string[] }[] = [];
  for (const [file, next] of touched) {
    const prev = mutable.forward.get(file);
    if (prev !== undefined ? sameTargets(prev, next) : next.length === 0) continue;
    changed.push({ file, prev: prev ?? NO_OUTGOING, next });
  }
  if (changed.length === 0) return { reached: mutable.reached, added: [], removed: [] };
  const affected = new Set<string>();
  for (const { file } of changed) for (const node of reachableFrom(mutable.forward, file)) affected.add(node);
  for (const { file, prev, next } of changed) {
    for (const to of prev) unlinkEdge(mutable.reverse, file, to);
    mutable.forward.delete(file);
    for (const to of next) linkEdge(mutable.forward, mutable.reverse, file, to);
  }
  for (const { file } of changed) for (const node of reachableFrom(mutable.forward, file)) affected.add(node);
  const seeds: string[] = [];
  if (affected.has(mutable.root)) seeds.push(mutable.root);
  for (const node of affected) {
    const sources = mutable.reverse.get(node);
    if (sources === undefined) continue;
    for (const source of sources) {
      if (!affected.has(source) && mutable.reached.has(source)) {
        seeds.push(node);
        break;
      }
    }
  }
  const kept = new Set<string>(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const outgoing = mutable.forward.get(current);
    if (outgoing === undefined) continue;
    for (const to of outgoing) {
      if (!affected.has(to) || kept.has(to)) continue;
      kept.add(to);
      queue.push(to);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  for (const node of affected) {
    if (kept.has(node)) {
      if (!mutable.reached.has(node)) added.push(node);
    } else if (mutable.reached.has(node)) removed.push(node);
  }
  added.sort();
  removed.sort();
  for (const node of removed) mutable.reached.delete(node);
  for (const node of added) mutable.reached.add(node);
  return { reached: mutable.reached, added, removed };
}

function linkEdge(forward: Map<string, Set<string>>, reverse: Map<string, Set<string>>, file: string, to: string): void {
  let outgoing = forward.get(file);
  if (outgoing === undefined) {
    outgoing = new Set();
    forward.set(file, outgoing);
  }
  outgoing.add(to);
  let sources = reverse.get(to);
  if (sources === undefined) {
    sources = new Set();
    reverse.set(to, sources);
  }
  sources.add(file);
}

function unlinkEdge(reverse: Map<string, Set<string>>, file: string, to: string): void {
  const sources = reverse.get(to);
  if (sources === undefined) return;
  sources.delete(file);
  if (sources.size === 0) reverse.delete(to);
}

function reachableFrom(forward: ReadonlyMap<string, ReadonlySet<string>>, start: string): Set<string> {
  const found = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const outgoing = forward.get(current);
    if (outgoing === undefined) continue;
    for (const to of outgoing) {
      if (found.has(to)) continue;
      found.add(to);
      queue.push(to);
    }
  }
  return found;
}

function sameTargets(current: ReadonlySet<string>, next: readonly string[]): boolean {
  const wanted = new Set(next);
  if (wanted.size !== current.size) return false;
  for (const to of wanted) if (!current.has(to)) return false;
  return true;
}

export type ReachNode<N> = {
  readonly object: string;
  readonly rank: number;
  readonly out: readonly string[];
  readonly watch: readonly string[];
  readonly note: N;
};

export type ReachRows<N> = {
  readonly node: (path: string) => ReachNode<N> | undefined;
  readonly sources: (path: string) => Iterable<string>;
  readonly watchers: (key: string) => Iterable<string>;
};

export type Derived<N> = { readonly out: readonly string[]; readonly watch: readonly string[]; readonly note: N } | null;

export type ReachChange = {
  readonly paths: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[];
  readonly packages: readonly string[];
};

export type ReachDelta<N> = {
  readonly nodes: ReadonlyMap<string, ReachNode<N> | null>;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly derived: readonly string[];
};

type Held<N> = {
  object: string;
  rank: number;
  out: Set<string>;
  watch: readonly string[];
  note: N;
  readonly existed: boolean;
};

export function reachDelta<N>(
  rows: ReachRows<N>,
  root: string,
  change: ReachChange,
  derive: (path: string) => Derived<N>,
  object: (path: string) => string | undefined,
): ReachDelta<N> {
  const held = new Map<string, Held<N> | null>();
  const unknown = new Set<string>();
  const untracked = new Set<string>();
  const gained = new Map<string, Set<string>>();
  const written = new Set<string>();
  const read = (path: string): Held<N> | null | undefined => {
    if (held.has(path)) return held.get(path);
    if (unknown.has(path)) return undefined;
    const row = rows.node(path);
    if (row === undefined) {
      unknown.add(path);
      return undefined;
    }
    const entry: Held<N> = { object: row.object, rank: row.rank, out: new Set(row.out), watch: row.watch, note: row.note, existed: true };
    held.set(path, entry);
    return entry;
  };
  const gain = (from: string, to: string): void => {
    const into = gained.get(to);
    if (into === undefined) gained.set(to, new Set([from]));
    else into.add(from);
  };
  const create = (path: string, next: NonNullable<Derived<N>>, rank: number, grow: [string, string][]): void => {
    held.set(path, { object: object(path) ?? '', rank, out: new Set(next.out), watch: next.watch, note: next.note, existed: false });
    written.add(path);
    for (const to of new Set(next.out)) {
      gain(path, to);
      grow.push([path, to]);
    }
  };

  const dirty = new Set<string>();
  for (const { path, before, after } of change.paths) {
    if (path === root || read(path) !== undefined) dirty.add(path);
    if (after === null) for (const source of rows.sources(path)) dirty.add(source);
    if (before === null) for (const watcher of rows.watchers(`p:${path}`)) dirty.add(watcher);
  }
  for (const name of change.packages) for (const watcher of rows.watchers(`k:${name}`)) dirty.add(watcher);

  const suspects: string[] = [];
  const grow: [string, string][] = [];
  const dropped: string[] = [];
  const derived: string[] = [];
  const added = new Set<string>();
  for (const path of dirty) {
    const entry = read(path);
    const next = derive(path);
    if (entry === undefined || entry === null) {
      if (path !== root || next === null) continue;
      create(path, next, 0, grow);
      added.add(path);
      continue;
    }
    if (next === null) {
      held.set(path, null);
      dropped.push(path);
      suspects.push(...entry.out);
      continue;
    }
    const out = new Set(next.out);
    for (const to of entry.out) if (!out.has(to)) suspects.push(to);
    for (const to of out) {
      if (entry.out.has(to)) continue;
      gain(path, to);
      grow.push([path, to]);
    }
    entry.out = out;
    entry.watch = next.watch;
    entry.note = next.note;
    entry.object = object(path) ?? entry.object;
    written.add(path);
    derived.push(path);
  }

  for (let i = 0; i < grow.length; i++) {
    const [from, to] = grow[i] as [string, string];
    const source = read(from);
    if (source === undefined || source === null || untracked.has(to) || read(to) !== undefined) continue;
    const next = derive(to);
    if (next === null) {
      untracked.add(to);
      continue;
    }
    create(to, next, source.rank + 1, grow);
    added.add(to);
  }

  const supportCache = new Map<string, readonly string[]>();
  const supporters = (path: string): readonly string[] => {
    const known = supportCache.get(path);
    if (known !== undefined) return known;
    const found = new Set<string>();
    for (const source of rows.sources(path)) found.add(source);
    for (const source of gained.get(path) ?? []) found.add(source);
    const live = [...found].filter((source) => read(source)?.out.has(path) === true);
    supportCache.set(path, live);
    return live;
  };

  const suspect = new Set<string>();
  while (suspects.length > 0) {
    const path = suspects.pop() as string;
    if (path === root || suspect.has(path)) continue;
    const entry = read(path);
    if (entry === undefined || entry === null) continue;
    if (supporters(path).some((source) => !suspect.has(source) && (read(source) as Held<N>).rank < entry.rank)) continue;
    suspect.add(path);
    suspects.push(...entry.out);
  }

  const seeds: [string, number][] = [];
  for (const path of suspect) {
    let best = Number.POSITIVE_INFINITY;
    for (const source of supporters(path)) if (!suspect.has(source)) best = Math.min(best, (read(source) as Held<N>).rank + 1);
    if (best !== Number.POSITIVE_INFINITY) seeds.push([path, best]);
  }
  seeds.sort((a, b) => a[1] - b[1]);
  const placed = new Map<string, number>();
  for (let i = 0; i < seeds.length; i++) {
    const [path, rank] = seeds[i] as [string, number];
    if (placed.has(path)) continue;
    placed.set(path, rank);
    for (const to of (read(path) as Held<N>).out) if (suspect.has(to) && !placed.has(to)) seeds.push([to, rank + 1]);
  }

  const removed: string[] = [];
  for (const path of dropped) removed.push(path);
  for (const path of suspect) {
    const entry = read(path) as Held<N>;
    const rank = placed.get(path);
    if (rank !== undefined) {
      if (rank !== entry.rank) written.add(path);
      entry.rank = rank;
      continue;
    }
    held.set(path, null);
    written.delete(path);
    if (added.delete(path)) continue;
    removed.push(path);
  }
  for (const path of dropped) {
    for (const source of supporters(path)) {
      const entry = read(source);
      if (entry === undefined || entry === null) continue;
      entry.out.delete(path);
      written.add(source);
    }
  }

  const alive = (path: string): boolean => {
    if (held.has(path)) return held.get(path) !== null;
    return !untracked.has(path) && !unknown.has(path);
  };
  const nodes = new Map<string, ReachNode<N> | null>();
  for (const path of written) {
    const entry = held.get(path);
    if (entry === undefined || entry === null) continue;
    nodes.set(path, { object: entry.object, rank: entry.rank, out: [...entry.out].filter(alive), watch: entry.watch, note: entry.note });
  }
  for (const path of removed) nodes.set(path, null);
  return {
    nodes,
    added: [...added].sort(),
    removed: removed.sort(),
    derived: derived.filter((path) => held.get(path) !== null).sort(),
  };
}

export function overlay<N>(rows: ReachRows<N>, delta: ReachDelta<N>): ReachRows<N> {
  const into = new Map<string, string[]>();
  const watching = new Map<string, string[]>();
  const append = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const [path, node] of delta.nodes) {
    if (node === null) continue;
    for (const to of node.out) append(into, to, path);
    for (const key of node.watch) append(watching, key, path);
  }
  function* merged(base: Iterable<string>, extra: readonly string[] | undefined): Iterable<string> {
    for (const path of base) if (!delta.nodes.has(path)) yield path;
    if (extra !== undefined) yield* extra;
  }
  return {
    node: (path) => (delta.nodes.has(path) ? (delta.nodes.get(path) ?? undefined) : rows.node(path)),
    sources: (path) => merged(rows.sources(path), into.get(path)),
    watchers: (key) => merged(rows.watchers(key), watching.get(key)),
  };
}
