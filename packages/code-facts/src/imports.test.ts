import { describe, expect, it } from 'bun:test';
import { type Derived, overlay, type ReachDelta, type ReachNode, type ReachRows, reachDelta } from './imports';

type Source = { readonly revision: number; readonly imports: readonly string[] };

type World = {
  readonly files: Map<string, Source>;
  readonly packages: Map<string, string>;
  readonly nodes: Map<string, ReachNode<number>>;
  readonly reads: { node: number; sources: number; watchers: number; derive: string[] };
  readonly rows: ReachRows<number>;
};

const ROOT = 'root';

const world = (graph: Record<string, readonly string[]>, packages: Record<string, string> = {}): World => {
  const files = new Map(Object.entries(graph).map(([path, imports]) => [path, { revision: 1, imports }]));
  const nodes = new Map<string, ReachNode<number>>();
  const reads = { node: 0, sources: 0, watchers: 0, derive: [] as string[] };
  const rows: ReachRows<number> = {
    node: (path) => {
      reads.node++;
      return nodes.get(path);
    },
    sources: (path) => {
      reads.sources++;
      return [...nodes].filter(([, node]) => node.out.includes(path)).map(([from]) => from);
    },
    watchers: (key) => {
      reads.watchers++;
      return [...nodes].filter(([, node]) => node.watch.includes(key)).map(([from]) => from);
    },
  };
  const made: World = { files, packages: new Map(Object.entries(packages)), nodes, reads, rows };
  land(made, { paths: [{ path: ROOT, before: null, after: '1' }], packages: [] });
  return made;
};

const resolve = (at: World, spec: string): { readonly to?: string; readonly watch: string } => {
  if (spec.startsWith('@')) {
    const to = at.packages.get(spec);
    return { to: to !== undefined && at.files.has(to) ? to : undefined, watch: `k:${spec}` };
  }
  return { to: at.files.has(spec) ? spec : undefined, watch: `p:${spec}` };
};

const deriving =
  (at: World) =>
  (path: string): Derived<number> => {
    at.reads.derive.push(path);
    const file = at.files.get(path);
    if (file === undefined) return null;
    const resolved = file.imports.map((spec) => resolve(at, spec));
    return {
      out: resolved.flatMap(({ to }) => (to === undefined ? [] : [to])),
      watch: resolved.flatMap(({ to, watch }) => (to === undefined || watch.startsWith('k:') ? [watch] : [])),
      note: file.revision,
    };
  };

const objectOf = (at: World) => (path: string) => {
  const file = at.files.get(path);
  return file === undefined ? undefined : `${path}@${file.revision}`;
};

const apply = (at: World, delta: ReachDelta<number>): void => {
  for (const [path, node] of delta.nodes) {
    if (node === null) at.nodes.delete(path);
    else at.nodes.set(path, node);
  }
};

function land(at: World, change: Parameters<typeof reachDelta>[2]): ReachDelta<number> {
  at.reads.node = 0;
  at.reads.sources = 0;
  at.reads.watchers = 0;
  at.reads.derive = [];
  const delta = reachDelta(at.rows, ROOT, change, deriving(at), objectOf(at));
  apply(at, delta);
  return delta;
}

const edit = (at: World, edits: Record<string, readonly string[] | null>, packages: Record<string, string> = {}) => {
  const paths = Object.entries(edits).map(([path, imports]) => {
    const held = at.files.get(path);
    const revision = (held?.revision ?? 0) + 1;
    if (imports === null) at.files.delete(path);
    else at.files.set(path, { revision, imports });
    return { path, before: held === undefined ? null : String(held.revision), after: imports === null ? null : String(revision) };
  });
  for (const [name, to] of Object.entries(packages)) at.packages.set(name, to);
  return land(at, { paths, packages: Object.keys(packages) });
};

const expectExact = (at: World): void => {
  const derive = deriving(at);
  const reached = new Set<string>();
  const queue = at.files.has(ROOT) ? [ROOT] : [];
  for (const path of queue) {
    if (reached.has(path)) continue;
    reached.add(path);
    queue.push(...(derive(path)?.out ?? []));
  }
  expect([...at.nodes.keys()].sort()).toEqual([...reached].sort());
  for (const [path, node] of at.nodes) {
    const truth = derive(path) as NonNullable<Derived<number>>;
    expect([...node.out].sort()).toEqual([...new Set(truth.out)].sort());
    expect([...node.watch].sort()).toEqual([...truth.watch].sort());
    expect(node.note).toBe(truth.note);
    expect(node.object).toBe(objectOf(at)(path) as string);
    if (path === ROOT) expect(node.rank).toBe(0);
    else expect([...at.nodes.values()].some((source) => source.out.includes(path) && source.rank < node.rank)).toBe(true);
  }
};

describe('reachDelta', () => {
  it('reads only the new subtree when the root gains an import, however large the closure', () => {
    const graph: Record<string, string[]> = { [ROOT]: ['n0'] };
    for (let i = 0; i < 200; i++) graph[`n${i}`] = i + 1 < 200 ? [`n${i + 1}`] : [];
    const at = world(graph);
    at.files.set('fresh', { revision: 1, imports: [] });
    const delta = edit(at, { [ROOT]: ['n0', 'fresh'] });
    expect(delta.added).toEqual(['fresh']);
    expect(delta.removed).toEqual([]);
    expect(at.reads.derive).toEqual([ROOT, 'fresh']);
    expect(at.reads.node).toBe(2);
    expect(at.reads.sources).toBe(0);
    expect([...delta.nodes.keys()].sort()).toEqual(['fresh', ROOT]);
    expectExact(at);
  });

  it('keeps a target that loses one of two parents after one sources read', () => {
    const at = world({ [ROOT]: ['a', 'b'], a: ['c'], b: ['c'], c: [] });
    const delta = edit(at, { a: [] });
    expect(delta.removed).toEqual([]);
    expect(at.reads.sources).toBe(1);
    expect([...delta.nodes.keys()]).toEqual(['a']);
    expectExact(at);
  });

  it('removes a cycle cut from the root', () => {
    const at = world({ [ROOT]: ['a'], a: ['b'], b: ['a'] });
    const delta = edit(at, { [ROOT]: [] });
    expect(delta.removed).toEqual(['a', 'b']);
    expectExact(at);
  });

  it('keeps a cycle that still has an outside parent, re-ranking the member that lost its entry', () => {
    const at = world({ [ROOT]: ['a', 'x'], a: ['b'], b: ['a'], x: ['b'] });
    const delta = edit(at, { [ROOT]: ['x'] });
    expect(delta.removed).toEqual([]);
    expect(at.nodes.get('a')?.rank).toBeGreaterThan(at.nodes.get('b')?.rank as number);
    expectExact(at);
  });

  it('removes exactly the tail of a chain cut midway', () => {
    const at = world({ [ROOT]: ['a'], a: ['b'], b: ['c'], c: ['d'], d: [] });
    const delta = edit(at, { b: [] });
    expect(delta.removed).toEqual(['c', 'd']);
    expectExact(at);
  });

  it('keeps an old target that a new file now imports, without deriving it again', () => {
    const at = world({ [ROOT]: ['x'], x: ['y'], y: [] });
    const delta = edit(at, { n: ['x'], [ROOT]: ['n'] });
    expect(delta.added).toEqual(['n']);
    expect(delta.removed).toEqual([]);
    expect(at.reads.derive).not.toContain('x');
    expectExact(at);
  });

  it('re-derives the importer whose missing target appears', () => {
    const at = world({ [ROOT]: ['a'], a: ['late'] });
    const delta = edit(at, { late: [] });
    expect(delta.derived).toEqual(['a']);
    expect(delta.added).toEqual(['late']);
    expectExact(at);
  });

  it('re-derives the importer of a deleted target and drops the target', () => {
    const at = world({ [ROOT]: ['a'], a: ['b'], b: ['c'], c: [] });
    const delta = edit(at, { b: null });
    expect(delta.derived).toEqual(['a']);
    expect(delta.removed).toEqual(['b', 'c']);
    expectExact(at);
  });

  it('re-derives only the watchers of a package whose member moved', () => {
    const at = world({ [ROOT]: ['a', 'b'], a: ['@k'], b: [], one: [], two: [] }, { '@k': 'one' });
    const delta = edit(at, {}, { '@k': 'two' });
    expect(at.reads.derive).toEqual(['a', 'two']);
    expect(delta.derived).toEqual(['a']);
    expect(delta.added).toEqual(['two']);
    expect(delta.removed).toEqual(['one']);
    expectExact(at);
  });

  it('drops everything when the root goes, and grows it back when it returns', () => {
    const at = world({ [ROOT]: ['a'], a: ['b'], b: ['a'] });
    expect(edit(at, { [ROOT]: null }).removed).toEqual(['a', 'b', ROOT]);
    expect(at.nodes.size).toBe(0);
    expect(edit(at, { [ROOT]: ['b'] }).added).toEqual(['a', 'b', ROOT]);
    expectExact(at);
  });

  it('matches a fresh walk of the new graph over random edits, and its overlay matches the applied rows', () => {
    const names = Array.from({ length: 24 }, (_, i) => `f${i}`);
    for (let seed = 1; seed <= 16; seed++) {
      let state = seed;
      const random = (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      const pick = (): string => (random() < 0.08 ? ROOT : (names[Math.floor(random() * names.length)] as string));
      const imports = (): string[] => Array.from({ length: Math.floor(random() * 4) }, pick);
      const graph: Record<string, string[]> = { [ROOT]: imports() };
      for (const name of names) if (random() < 0.7) graph[name] = imports();
      const at = world(graph);
      expectExact(at);
      for (let round = 0; round < 25; round++) {
        const edits: Record<string, string[] | null> = {};
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i++) {
          const path = pick();
          edits[path] = at.files.has(path) && random() < 0.3 ? null : imports();
        }
        const before = new Map(at.nodes);
        const paths = Object.entries(edits).map(([path, next]) => {
          const held = at.files.get(path);
          const revision = (held?.revision ?? 0) + 1;
          if (next === null) at.files.delete(path);
          else at.files.set(path, { revision, imports: next });
          return { path, before: held === undefined ? null : String(held.revision), after: next === null ? null : String(revision) };
        });
        const delta = reachDelta(at.rows, ROOT, { paths, packages: [] }, deriving(at), objectOf(at));
        const seen = overlay(at.rows, delta);
        const view = [...new Set([...before.keys(), ...names, ROOT])].map((path) => [
          path,
          seen.node(path),
          [...seen.sources(path)].sort(),
        ]);
        apply(at, delta);
        expect(view).toEqual(
          [...new Set([...before.keys(), ...names, ROOT])].map((path) => [path, at.rows.node(path), [...at.rows.sources(path)].sort()]),
        );
        expectExact(at);
      }
    }
  });
});
