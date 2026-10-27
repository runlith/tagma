import type { ReachDelta, ReachRows } from '@runlith/code-facts/imports';
import type { Tree } from '@runlith/code-facts/tree';
import type { Violation } from '../verdict';

export const MEMO_BYTES = 32 * 1024 * 1024;

export type Keyed = { readonly key: string; readonly violation: Violation };

export type Hit = {
  readonly group: string;
  readonly origin?: string;
  readonly suffix: string;
  readonly distance: number;
  readonly chain: readonly string[];
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly message?: string;
  readonly fix?: string;
  readonly absent?: readonly string[];
};

export type MemoValue = {
  readonly dependencies: readonly (readonly [string, string | null])[];
  readonly installed?: readonly (readonly [string, string | null])[];
  readonly listings: readonly (readonly [string, string])[];
  readonly parents?: readonly string[];
  readonly violations: readonly Violation[];
  readonly universal?: readonly Keyed[];
  readonly hits?: readonly Hit[];
  readonly started?: boolean;
  readonly headroom?: number;
  readonly read: readonly string[];
};

export type MemoStats = { starts: number; walked: number; blobs: number };

export type ReachHead = { readonly tree: string; readonly generation: number };

export type ReachView<N, M> = ReachRows<N> & {
  readonly head: ReachHead | undefined;
  readonly members: M | undefined;
};

export type ReachIndex<N, M> = ReachView<N, M> & {
  readonly stage: (from: ReachHead | undefined, to: string, delta: ReachDelta<N>, members: M, rebuild?: boolean) => void;
};

export type ReachApplied = 'applied' | 'moved' | 'full';

export class ReachHeadMoved extends Error {
  readonly expected: string | null;
  readonly found: string | null;
  constructor(expected: string | null, found: string | null) {
    super(`reach head moved: diff was computed from ${expected ?? '(absent)'} but the index now stands at ${found ?? '(absent)'}`);
    this.name = 'ReachHeadMoved';
    this.expected = expected;
    this.found = found;
  }
}

export type ReachTable = {
  readonly open: <N, M>(key: string) => ReachView<N, M>;
  readonly round?: <A>(work: () => A) => A;
  readonly apply: <N, M>(
    key: string,
    from: ReachHead | undefined,
    to: string,
    delta: ReachDelta<N>,
    members: M,
    rebuild?: boolean,
  ) => ReachApplied;
};

export type InspectionMemo = {
  readonly get: (key: string) => MemoValue | undefined;
  readonly set: (key: string, value: MemoValue) => void;
  readonly stats?: MemoStats;
  readonly reach?: <N, M>(key: string) => ReachIndex<N, M>;
  readonly checked?: Checked;
};

export type Objects = (name: string) => string | null;

export const objectsOf = (tree: Tree): Objects | undefined => {
  const object = tree.object;
  return object === undefined ? undefined : (name) => object(name) ?? null;
};

export function validMemo(
  key: string,
  objects: Objects | undefined,
  listing: (query: string) => string,
  store: InspectionMemo,
  checked: Checked,
): boolean {
  if (objects === undefined) return false;
  const decided = new Map<string, boolean>();
  const pending: { key: string; value?: MemoValue }[] = [{ key }];
  const open = new Set<string>();
  while (pending.length > 0) {
    const at = pending[pending.length - 1]!;
    if (decided.has(at.key)) {
      pending.pop();
      continue;
    }
    if (at.value === undefined) {
      const prior = checked.known(at.key);
      if (prior !== undefined) {
        decided.set(at.key, prior);
        pending.pop();
        continue;
      }
      const value = store.get(at.key);
      if (value === undefined) {
        decided.set(at.key, false);
        pending.pop();
        continue;
      }
      at.value = value;
      open.add(at.key);
      for (const parent of value.parents ?? []) {
        if (open.has(parent)) {
          decided.set(parent, false);
          continue;
        }
        if (!decided.has(parent)) pending.push({ key: parent });
      }
    } else {
      const valid =
        (at.value.parents ?? []).every((parent) => decided.get(parent) === true) &&
        (checked.stands(at.key) ||
          (at.value.dependencies.every(([name, object]) => objects(name) === object) &&
            at.value.listings.every(([query, stamp]) => listing(query) === stamp))) &&
        (at.value.installed ?? []).every(([path, stamp]) => objects(path) === stamp);
      decided.set(at.key, valid);
      checked.settle(at.key, valid, at.value);
      open.delete(at.key);
      pending.pop();
    }
  }
  return decided.get(key) === true;
}

type Staged = {
  readonly key: string;
  readonly from: ReachHead | undefined;
  readonly to: string;
  readonly delta: ReachDelta<unknown>;
  readonly members: unknown;
  readonly rebuild: boolean;
};

export function memoWrites(
  store: InspectionMemo,
  table?: ReachTable,
  validity?: Validity,
): InspectionMemo & { readonly commit: () => void } {
  const pending = new Map<string, MemoValue>();
  const loaded = new Map<string, MemoValue | undefined>();
  const views = new Map<string, ReachView<unknown, unknown>>();
  const staged: Staged[] = [];
  const reach = <N, M>(key: string): ReachIndex<N, M> => {
    let view = views.get(key) as ReachView<N, M> | undefined;
    if (view === undefined) {
      view = table!.open<N, M>(key);
      views.set(key, view as ReachView<unknown, unknown>);
    }
    const held = view;
    return {
      get head() {
        return held.head;
      },
      get members() {
        return held.members;
      },
      node: (path) => held.node(path),
      sources: (path) => held.sources(path),
      watchers: (watch) => held.watchers(watch),
      stage: (from, to, delta, members, rebuild = false) => {
        staged.push({ key, from, to, delta, members, rebuild });
      },
    };
  };
  return {
    get: (key) => {
      if (pending.has(key)) return pending.get(key);
      if (!loaded.has(key)) loaded.set(key, store.get(key));
      return loaded.get(key);
    },
    set: (key, value) => {
      pending.set(key, value);
    },
    stats: store.stats,
    reach: table === undefined ? undefined : reach,
    checked: validity === undefined ? undefined : checkedOnce(validity),
    commit: () => {
      for (const [key, value] of pending) store.set(key, value);
      for (const one of staged) table!.apply(one.key, one.from, one.to, one.delta, one.members, one.rebuild);
    },
  };
}

export type Checked = {
  readonly known: (key: string) => boolean | undefined;
  readonly stands: (key: string) => boolean;
  readonly settle: (key: string, valid: boolean, value: MemoValue) => void;
};

export type Change = { readonly path: string; readonly before: string | null; readonly after: string | null };

export const WHOLE = '/**/';

export const wholeUnit = (dir: string): string => `${dir}${WHOLE}`;

export const parentOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
};

export const listedUnit = (dir: string): string => `${dir}/`;

export const touchedNames = (path: string, membership: boolean): readonly string[] => {
  const names = [path];
  if (membership) names.push(listedUnit(parentOf(path)));
  for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) names.push(wholeUnit(dir));
  return names;
};

export const checkedOnce = (validity?: Validity): Checked => {
  const held = new Map<string, boolean>();
  return {
    known: (key) => held.get(key),
    stands: (key) => validity?.stands(key) === true,
    settle: (key, valid, value) => {
      held.set(key, valid);
      if (valid) validity?.settle(key, value);
    },
  };
};

type Indexed = { readonly value: MemoValue; readonly epoch: number };

export type HeldEntry = readonly [key: string, names: readonly string[], parents: readonly string[], listed: boolean];

type Moved = { readonly names: ReadonlySet<string>; readonly membership: boolean };

export class Dependents {
  private epoch = 0;
  private readonly keys = new Map<string, Indexed>();
  private readonly byName = new Map<string, Set<string>>();
  private readonly byParent = new Map<string, Set<string>>();
  private readonly listed = new Set<string>();

  constructor(readonly capacity: number) {}

  now(): number {
    return this.epoch;
  }

  indexed(key: string): Indexed | undefined {
    return this.keys.get(key);
  }

  add(key: string, value: MemoValue): number {
    const held = this.keys.get(key);
    if (held !== undefined) {
      this.keys.delete(key);
      this.keys.set(key, held);
      return held.epoch;
    }
    const indexed = { value, epoch: ++this.epoch };
    this.keys.set(key, indexed);
    for (const [name] of value.dependencies) link(this.byName, name, key);
    for (const parent of value.parents ?? []) link(this.byParent, parent, key);
    if (value.listings.length > 0) this.listed.add(key);
    for (const [oldest] of this.keys) {
      if (this.keys.size <= this.capacity) break;
      this.evict(oldest);
    }
    return indexed.epoch;
  }

  dirty(moved: Moved): ReadonlySet<string> {
    const queue: string[] = [];
    for (const name of moved.names) for (const key of this.byName.get(name) ?? []) queue.push(key);
    if (moved.membership) queue.push(...this.listed);
    const dirty = new Set<string>();
    while (queue.length > 0) {
      const key = queue.pop()!;
      if (dirty.has(key)) continue;
      dirty.add(key);
      for (const child of this.byParent.get(key) ?? []) queue.push(child);
    }
    return dirty;
  }

  exported(keys: Iterable<string>): readonly HeldEntry[] {
    const entries: HeldEntry[] = [];
    for (const key of keys) {
      const held = this.keys.get(key);
      if (held !== undefined)
        entries.push([key, held.value.dependencies.map(([name]) => name), held.value.parents ?? [], held.value.listings.length > 0]);
    }
    return entries;
  }

  imported(entries: readonly HeldEntry[]): void {
    for (const [key, names, parents, listed] of entries) {
      this.add(key, {
        dependencies: names.map((name) => [name, null] as const),
        listings: listed ? [['', '']] : [],
        parents,
        violations: [],
        read: [],
      });
    }
  }

  private evict(key: string): void {
    const queue = [key];
    while (queue.length > 0) {
      const one = queue.pop()!;
      const held = this.keys.get(one);
      if (held === undefined) continue;
      queue.push(...(this.byParent.get(one) ?? []));
      this.keys.delete(one);
      for (const [name] of held.value.dependencies) unlink(this.byName, name, one);
      for (const parent of held.value.parents ?? []) unlink(this.byParent, parent, one);
      this.listed.delete(one);
    }
  }
}

const link = (index: Map<string, Set<string>>, name: string, key: string): void => {
  const held = index.get(name);
  if (held === undefined) index.set(name, new Set([key]));
  else held.add(key);
};

const unlink = (index: Map<string, Set<string>>, name: string, key: string): void => {
  const held = index.get(name);
  if (held === undefined) return;
  held.delete(key);
  if (held.size === 0) index.delete(name);
};

export const movedBy = (changes: readonly Change[]): Moved => ({
  names: new Set(changes.flatMap(({ path, before, after }) => touchedNames(path, before === null || after === null))),
  membership: changes.some(
    ({ path, before, after }) => before === null || after === null || path === 'package.json' || path.endsWith('/package.json'),
  ),
});

class Step {
  private readonly late = new Map<string, boolean>();

  constructor(
    readonly validity: Validity,
    private readonly dependents: Dependents,
    private readonly moved: Moved,
    private readonly dirtied: ReadonlySet<string>,
    private readonly asOf: number,
  ) {}

  dirty(key: string): boolean {
    const held = this.dependents.indexed(key);
    if (held === undefined) return true;
    if (held.epoch <= this.asOf) return this.dirtied.has(key);
    const known = this.late.get(key);
    if (known !== undefined) return known;
    this.late.set(key, true);
    const { value } = held;
    const dirty =
      value.dependencies.some(([name]) => this.moved.names.has(name)) ||
      (this.moved.membership && value.listings.length > 0) ||
      (value.parents ?? []).some((parent) => this.dirty(parent));
    this.late.set(key, dirty);
    return dirty;
  }
}

const FLATTEN_DEPTH = 16;

export class Validity {
  private readonly own = new Map<string, number>();

  private constructor(
    private readonly dependents: Dependents,
    private readonly before: Step | undefined,
    private readonly depth: number,
  ) {}

  static fresh(dependents: Dependents): Validity {
    return new Validity(dependents, undefined, 0);
  }

  static restored(dependents: Dependents, keys: Iterable<string>): Validity {
    const validity = new Validity(dependents, undefined, 0);
    for (const key of keys) {
      const indexed = dependents.indexed(key);
      if (indexed !== undefined) validity.own.set(key, indexed.epoch);
    }
    return validity;
  }

  held(): readonly string[] {
    return [...this.reachable()].filter((key) => {
      const indexed = this.dependents.indexed(key);
      return indexed !== undefined && this.carried(key) === indexed.epoch;
    });
  }

  stands(key: string): boolean {
    const indexed = this.dependents.indexed(key);
    return indexed !== undefined && this.carried(key) === indexed.epoch;
  }

  settle(key: string, value: MemoValue): void {
    this.own.set(key, this.dependents.add(key, value));
    if (this.own.size > 2 * this.dependents.capacity) {
      for (const [held, epoch] of this.own) if (this.dependents.indexed(held)?.epoch !== epoch) this.own.delete(held);
    }
  }

  derive(changes: readonly Change[]): Validity {
    const moved = movedBy(changes);
    const step = new Step(this, this.dependents, moved, this.dependents.dirty(moved), this.dependents.now());
    const next = new Validity(this.dependents, step, this.depth + 1);
    return next.depth < FLATTEN_DEPTH ? next : next.flattened();
  }

  private carried(key: string): number | undefined {
    const own = this.own.get(key);
    if (own !== undefined) return own;
    for (let at = this.before; at !== undefined; at = at.validity.before) {
      if (at.dirty(key)) return undefined;
      const held = at.validity.own.get(key);
      if (held !== undefined) return held;
    }
    return undefined;
  }

  private flattened(): Validity {
    const flat = new Validity(this.dependents, undefined, 0);
    for (const key of this.reachable()) {
      const held = this.carried(key);
      if (held !== undefined && this.dependents.indexed(key)?.epoch === held) flat.own.set(key, held);
    }
    return flat;
  }

  private reachable(): ReadonlySet<string> {
    const keys = new Set<string>();
    for (let at: Validity | undefined = this; at !== undefined; at = at.before?.validity) for (const key of at.own.keys()) keys.add(key);
    return keys;
  }
}
