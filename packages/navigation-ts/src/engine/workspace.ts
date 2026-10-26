import { ChildProcess } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Judgement, Located } from '@runlith/navigation/adapter';
import { API, type Snapshot } from 'typescript7/async';
import { memoryOf } from '../memory';
import type { Asked, Asking, Drifted, Refused, Standing, Touched } from '../wire';
import {
  configsOf,
  type Dependencies,
  dependenciesOf,
  differencesOf,
  driftOf,
  hashingOf,
  headOf,
  LOCKS,
  locksMoved,
  type Moved,
  movedOf,
  reckon,
  relevant,
  requestOf,
  storeOf,
  tracked,
} from './checkout';
import { makeHeld } from './held';
import { makeQuiet } from './quiet';
import { makeSemantics, type Semantics } from './semantics';
import { type Catalog, makeCatalog, makeView, type View } from './view';

type Tree = {
  readonly key: string;
  readonly root: string;
  readonly base: boolean;
  attached: boolean;
  ready: boolean;
  head: string;
  configs: readonly string[];
  differs: Map<string, string | null>;
  dependencies: Dependencies;
  serving: Served | null;
  readonly recent: Recent[];
  readonly pending: Pending[];
  readonly pins: Set<string>;
  absorbed: number;
  pumping: boolean;
  wanted: boolean;
  sought: boolean;
  resting: boolean;
};

type Served = {
  readonly owner: Tree;
  readonly view: View;
  readonly semantics: Semantics;
  readonly revision: string;
  readonly head: string;
};

type Found = { readonly moved: Moved | null; readonly paths: readonly string[] };

type Pending = {
  readonly seq: number;
  readonly touch: Touched['touch']['_tag'];
  readonly paths: readonly string[];
  readonly found: Promise<Found> | null;
};

type Recent = { readonly at: number; readonly key: string; readonly asked: Asked; readonly wants: readonly string[] };

type Plan = {
  readonly seq: number;
  readonly rescan: boolean;
  readonly dependencies: boolean;
  readonly head: string;
  readonly paths: readonly string[];
  readonly opened: readonly string[];
  readonly gone: readonly string[];
};

export type Answer = Judgement | Located;

export type Workspace = {
  readonly attach: (checkout: string) => void;
  readonly detach: (checkout: string) => void;
  readonly rest: (checkout: string) => void;
  readonly ask: (asking: Asking, signal: AbortSignal) => Promise<Answer>;
  readonly touch: (touched: Touched) => void;
  readonly drop: (checkout: string, revision: string) => void;
  readonly limit: (bytes: number) => void;
  readonly close: () => Promise<void>;
};

export type Reports = {
  readonly standing: (standing: Standing) => void;
  readonly drifted: (drifted: Drifted) => void;
  readonly refused: (refused: Refused) => void;
  readonly failed: (detail: string) => void;
};

const RECENT = 12;

//! Replay files per round trip: the compiler serves one batch at a time, so a question waits for at most this many files of warming.
const WARM_PACE = 8;

//! A worktree warms a snapshot of its own only while the engine's memory, with room for its own warm-up and one re-warm after an edit, stays under this share of its ceiling.
const ROOM = 0.9;

const NONE: Dependencies = { locks: [], links: null, problem: null, locked: '' };

const spawned = async (api: API, loading: Promise<unknown>): Promise<ChildProcess> => {
  for (;;) {
    const child: unknown = Reflect.get(Reflect.get(api, 'client') as object, 'process');
    if (child instanceof ChildProcess) return child;
    await Promise.race([loading, Bun.sleep(5)]);
  }
};

const serialized = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <A>(work: () => Promise<A>): Promise<A> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
};

const relinked = (left: Dependencies, right: Dependencies): boolean => left.links !== null || right.links !== null;

const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const makeWorkspace = async (key: string, compiler: string | undefined, reports: Reports): Promise<Workspace> => {
  const root = realpathSync(key);
  const hashing = await hashingOf(root);
  const api = new API({ cwd: root, tsserverPath: compiler });
  const kept = new Map<string, Served>();
  const claims = new Map<string, Set<string>>();
  const users = new Map<Snapshot, number>();
  const trees = new Map<string, Tree>();
  const unsettled = new Set<string>();
  const locked = serialized();
  let serial = 0;
  let questions = 0;
  let limit = Number.POSITIVE_INFINITY;
  let weighed: { readonly tree: Tree; readonly bytes: number } | null = null;
  let drifting = 0;
  let growth = 0;
  let answering = 0;
  let closed = false;

  const treeOf = (checkout: string, real: string, base: boolean): Tree => ({
    key: checkout,
    root: real,
    base,
    attached: false,
    ready: base,
    head: '',
    configs: [],
    differs: new Map(),
    dependencies: NONE,
    serving: null,
    recent: [],
    pending: [],
    pins: new Set(),
    absorbed: 0,
    pumping: false,
    wanted: false,
    sought: false,
    resting: false,
  });

  const base = treeOf(key, root, true);
  trees.set(key, base);

  const servedOf = (owner: Tree, snapshot: Snapshot, catalog: Catalog, head: string, revision?: string): Served => {
    const view = makeView(catalog, snapshot);
    serial += 1;
    return { owner, view, semantics: makeSemantics(view), head, revision: revision ?? `${head.slice(0, 12) || 'worktree'}.${serial}` };
  };

  const use = (snapshot: Snapshot) => {
    users.set(snapshot, (users.get(snapshot) ?? 0) + 1);
  };

  const unuse = (snapshot: Snapshot) => {
    const left = (users.get(snapshot) ?? 1) - 1;
    if (left > 0) {
      users.set(snapshot, left);
      return;
    }
    users.delete(snapshot);
    void snapshot.dispose().catch((cause: unknown) => reports.failed(`a snapshot of ${root} could not be released: ${said(cause)}`));
  };

  const current = (tree: Tree): Served | null => tree.serving ?? (tree.ready ? base.serving : null);

  const live = (revision: string): boolean => [...trees.values()].some((tree) => current(tree)?.revision === revision);

  const keep = (served: Served) => {
    const before = kept.get(served.revision);
    use(served.view.snapshot);
    kept.set(served.revision, served);
    if (before !== undefined) unuse(before.view.snapshot);
  };

  const release = (revision: string) => {
    if ((claims.get(revision)?.size ?? 0) > 0 || live(revision)) return;
    claims.delete(revision);
    const served = kept.get(revision);
    if (served === undefined) return;
    kept.delete(revision);
    unuse(served.view.snapshot);
  };

  const report = (tree: Tree) => {
    const served = current(tree);
    if (!tree.attached || served === null) return;
    claims.set(served.revision, (claims.get(served.revision) ?? new Set()).add(tree.key));
    const own = tree.serving !== null;
    const { locks, links, problem } = tree.dependencies;
    reports.standing({
      checkout: tree.key,
      revision: served.revision,
      absorbed: tree.absorbed,
      known: own || drifting === 0,
      warming: tree.pumping || (!own && base.pumping),
      problems: [...served.view.catalog.problems(), ...(problem === null ? [] : [problem])],
      changed: [...new Set([...(own ? [] : [...tree.differs.keys(), ...unsettled]), ...(own && links !== null ? [] : locks)])],
    });
  };

  //! Locates and judges keep a window each: one question about a common owner sends a locate per importing module, which would push out the programs its judge needs.
  const latest = (recent: readonly Recent[]): readonly Recent[] => {
    const last = new Map(recent.toSorted((left, right) => left.at - right.at).map((one) => [one.key, one] as const));
    const sorted = [...last.values()].toSorted((left, right) => left.at - right.at);
    const locates = sorted.filter((one) => one.asked._tag === 'locate').slice(-RECENT);
    const judges = sorted.filter((one) => one.asked._tag === 'judge').slice(-RECENT);
    return [...locates, ...judges].toSorted((left, right) => left.at - right.at);
  };

  const recentOf = (owner: Tree): readonly Recent[] =>
    owner.base
      ? latest([...trees.values()].filter((tree) => tree === owner || tree.serving === null).flatMap((tree) => tree.recent))
      : owner.recent;

  const windowed = (owner: Tree): ReadonlySet<string> => new Set(recentOf(owner).flatMap((one) => one.wants));

  const reopened = async (served: Served, opening: readonly string[], closing: readonly string[]): Promise<Served> => {
    const snapshot = await served.view.snapshot.update({ ensurePrograms: true, openProjects: opening, closeProjects: closing });
    const { catalog } = served.view;
    const renewed = new Set(opening.filter(catalog.stale));
    const projects = snapshot
      .getProjects()
      .filter((project) => project.configFileName !== undefined && renewed.has(project.configFileName));
    return servedOf(served.owner, snapshot, await catalog.record(projects), served.head, served.revision);
  };

  const settle = (revision: string, wants: readonly string[]) =>
    locked(async () => {
      const served = kept.get(revision);
      if (served === undefined) throw new Error(`the snapshot ${revision} was already released`);
      const { owner } = served;
      const opening = wants.filter((config) => !served.view.open.has(config));
      const staying = new Set([...windowed(owner), ...wants]);
      const closing = served === owner.serving ? [...served.view.open].filter((config) => !staying.has(config)) : [];
      let settled = served;
      if (opening.length > 0 || closing.length > 0) {
        settled = await reopened(served, opening, closing);
        if (kept.get(revision) !== served) {
          unuse(settled.view.snapshot);
          throw new Error(`the snapshot ${revision} was released while its programs opened`);
        }
        keep(settled);
        if (owner.serving === served) owner.serving = settled;
      }
      use(settled.view.snapshot);
      return settled;
    });

  const run = (served: Served, asked: Asked, signal: AbortSignal, pace?: number): Promise<Answer> =>
    asked._tag === 'locate' ? served.semantics.locate(asked.spot, signal) : served.semantics.judge(asked.judging, signal, pace);

  const warm = async (tree: Tree, served: Served) => {
    const signal = new AbortController().signal;
    for (const { asked, wants } of recentOf(tree)) {
      if (closed) return;
      if (!wants.every((config) => served.view.open.has(config))) continue;
      await run(served, asked, signal, WARM_PACE).catch((cause: unknown) => {
        console.error(`a recent question did not warm ${served.revision}: ${said(cause)}`);
      });
    }
  };

  const configured = async (tree: Tree) => {
    const known = new Set(tree.configs);
    tree.configs = (await configsOf(tree.root)).map((path) => join(root, path));
    return {
      opened: tree.configs.filter((config) => !known.has(config)),
      gone: [...known].filter((config) => !tree.configs.includes(config)),
    };
  };

  const seqOf = (tree: Tree, batch: readonly Pending[]) => Math.max(tree.absorbed, ...batch.map((one) => one.seq));

  const regionOf = (tree: Tree, moved: Moved): readonly string[] =>
    [...new Set([...tree.differs.keys(), ...moved.committed.keys(), ...moved.drift])].filter(tracked);

  const foundOf = async (tree: Tree): Promise<Found> => {
    const moved = await movedOf(tree.root, tree.head);
    if (tree.base) return { moved, paths: await held.shift(moved) };
    const region = regionOf(tree, moved);
    return { moved, paths: [...reckon(root, tree.root, region, new Map(tree.differs)), ...region.filter((path) => LOCKS.includes(path))] };
  };

  const movedIn = async (tree: Tree, batch: readonly Pending[], found: readonly (Found | null)[]): Promise<Moved | null> => {
    const last = batch.findLastIndex((one) => one.touch === 'head');
    const moved = found[last]?.moved ?? null;
    if (moved === null) return null;
    return moved.from === tree.head && last === batch.length - 1 ? moved : movedOf(tree.root, tree.head);
  };

  const planBase = async (batch: readonly Pending[]): Promise<Plan> => {
    const found = await Promise.all(batch.map((one) => one.found));
    const rescan = batch.some((one) => one.touch === 'rescan');
    const watched = batch.flatMap((one) => one.paths);
    const paths = new Set([...watched, ...(rescan ? found.flatMap((one) => one?.paths ?? []) : [])]);
    let dependencies = await held.accept(watched, base.head);
    const moved = rescan ? await movedOf(root, base.head) : await movedIn(base, batch, found);
    if (moved !== null) {
      const shifted = await held.move(moved);
      for (const path of shifted) paths.add(path);
      dependencies ||= shifted.some((path) => LOCKS.includes(path));
      base.head = moved.to;
    }
    return { seq: seqOf(base, batch), rescan, dependencies, head: base.head, paths: [...paths], ...(await configured(base)) };
  };

  const renewBase = (plan: Plan) =>
    locked(async (): Promise<Served> => {
      const from = base.serving;
      if (from === null) throw new Error(`the base ${root} lost its snapshot`);
      const paths = plan.paths.filter(relevant);
      const invalidated = plan.rescan || plan.dependencies;
      if (!invalidated && paths.length === 0 && plan.opened.length === 0 && plan.gone.length === 0)
        return servedOf(base, from.view.snapshot, from.view.catalog, plan.head);
      const absolute = paths.map((path) => join(root, path));
      const present = absolute.filter((file) => existsSync(file));
      const created = present.filter((file) => !from.view.catalog.holds(file));
      const deleted = absolute.filter((file) => !existsSync(file));
      const touched = from.view.catalog.touched(absolute, from.view.open).forget(plan.gone);
      const snapshot = await from.view.snapshot.update({
        ensurePrograms: true,
        openProjects: plan.rescan ? base.configs.filter((config) => !from.view.open.has(config)) : plan.opened,
        closeProjects: plan.gone.filter((config) => from.view.open.has(config)),
        fileNotifications: invalidated
          ? { invalidateAll: true }
          : { changed: present.filter((file) => !created.includes(file)), created, deleted },
      });
      const catalog = plan.dependencies && !plan.rescan ? touched.outdated(from.view.open) : touched;
      return servedOf(base, snapshot, await catalog.record(snapshot.getProjects()), plan.head);
    });

  const renewTree = (tree: Tree, plan: Plan, derive: boolean) =>
    locked(async (): Promise<Served> => {
      const from = derive ? base.serving : tree.serving;
      if (from === null) throw new Error(`the worktree ${tree.root} lost the snapshot it renews`);
      const paths = derive ? [...new Set([...tree.differs.keys(), ...unsettled])].filter(relevant) : plan.paths.filter(relevant);
      if (!derive && paths.length === 0 && plan.opened.length === 0 && plan.gone.length === 0)
        return servedOf(tree, from.view.snapshot, from.view.catalog, tree.head);
      const known = new Set(from.view.catalog.configs());
      const wanted = new Set(tree.configs);
      const gone = derive ? [...known].filter((config) => !wanted.has(config)) : plan.gone;
      const absolute = paths.map((path) => join(root, path));
      const snapshot = await from.view.snapshot.update({
        ensurePrograms: true,
        fileSystem: requestOf(root, tree.root, paths, derive ? tree.dependencies.links : null),
        openProjects: derive ? tree.configs.filter((config) => !known.has(config)) : plan.opened,
        closeProjects: gone.filter((config) => from.view.open.has(config)),
      });
      const catalog = (derive ? from.view.catalog.within(tree.root) : from.view.catalog).touched(absolute, from.view.open).forget(gone);
      return servedOf(tree, snapshot, await catalog.record(snapshot.getProjects()), tree.head);
    });

  const swap = async (tree: Tree, fresh: Served, seq: number) => {
    use(fresh.view.snapshot);
    if (fresh.view.snapshot !== tree.serving?.view.snapshot) await warm(tree, fresh);
    if (trees.get(tree.key) !== tree) {
      unuse(fresh.view.snapshot);
      return;
    }
    keep(fresh);
    unuse(fresh.view.snapshot);
    const before = tree.serving;
    tree.serving = fresh;
    tree.absorbed = seq;
    tree.wanted = false;
    if (before !== null && before.revision !== fresh.revision) release(before.revision);
  };

  const stepBase = async (batch: readonly Pending[]) => {
    const plan = await planBase(batch);
    await swap(base, await renewBase(plan), plan.seq);
    const again = new Set(base.pending.flatMap((one) => one.paths));
    for (const path of plan.paths) if (!again.has(path)) unsettled.delete(path);
    const locks = plan.paths.some((path) => LOCKS.includes(path));
    for (const tree of trees.values()) {
      if (tree.base || !tree.ready) continue;
      reckon(root, tree.root, plan.paths, tree.differs);
      let outdated = plan.rescan || plan.dependencies;
      if (plan.rescan || (locks && locksMoved(root, tree.root, tree.dependencies))) {
        const dependencies = await dependenciesOf(root, tree.root);
        outdated ||= relinked(dependencies, tree.dependencies);
        tree.dependencies = dependencies;
      }
      if (outdated && tree.serving !== null) retire(tree);
      if (tree.serving === null && !tree.pumping) {
        report(tree);
        continue;
      }
      for (const path of plan.paths) tree.pins.add(path);
      pump(tree);
    }
  };

  const stepTree = async (tree: Tree, batch: readonly Pending[], pins: readonly string[]) => {
    const found = await Promise.all(batch.map((one) => one.found));
    const rescan = batch.some((one) => one.touch === 'rescan');
    const watched = [...new Set([...batch.flatMap((one) => one.paths), ...pins])];
    let paths = watched;
    let derive = tree.wanted;
    if (rescan) {
      const [head, differs, dependencies] = await Promise.all([
        headOf(tree.root),
        differencesOf(root, tree.root),
        dependenciesOf(root, tree.root),
      ]);
      tree.head = head;
      tree.differs = differs;
      tree.dependencies = dependencies;
      derive ||= tree.serving !== null;
    } else {
      const moved = await movedIn(tree, batch, found);
      const region = moved === null ? [] : regionOf(tree, moved);
      paths = [...new Set([...watched, ...reckon(root, tree.root, region, tree.differs)])];
      reckon(root, tree.root, watched, tree.differs);
      if (moved !== null) tree.head = moved.to;
      if ([...watched, ...region].some((path) => LOCKS.includes(path)) && locksMoved(root, tree.root, tree.dependencies)) {
        const dependencies = await dependenciesOf(root, tree.root);
        derive ||= relinked(dependencies, tree.dependencies) && tree.serving !== null;
        tree.dependencies = dependencies;
      }
    }
    const plan: Plan = { seq: seqOf(tree, batch), rescan, dependencies: false, head: tree.head, paths, ...(await configured(tree)) };
    if ((tree.differs.size === 0 && tree.dependencies.links === null) || (!derive && tree.serving === null)) {
      const before = tree.serving;
      tree.serving = null;
      tree.wanted = false;
      tree.absorbed = plan.seq;
      if (before !== null) release(before.revision);
    } else await swap(tree, await renewTree(tree, plan, derive), plan.seq);
    if (weighed?.tree !== tree) return;
    growth = Math.max(growth, (await memoryOf(process.pid)) - weighed.bytes);
    weighed = null;
  };

  const refuse = (tree: Tree, detail: string) => {
    if (trees.get(tree.key) !== tree) return;
    detach(tree.key);
    reports.refused({ checkout: tree.key, detail });
  };

  const borrowers = (): readonly Tree[] => [...trees.values()].filter((tree) => !tree.base && tree.serving === null);

  const unsettle = (paths: readonly string[]) => {
    const fresh = paths.filter((path) => relevant(path) && !unsettled.has(path));
    for (const path of fresh) unsettled.add(path);
    return fresh.length > 0;
  };

  const working = () => answering > 0 || [...trees.values()].some((tree) => tree.pumping);

  const quiet = makeQuiet(api, root, working);
  const { still, calm } = quiet;

  const letGo = (tree: Tree) => {
    tree.resting = false;
    const own = tree.serving;
    if (own === null) return;
    tree.serving = null;
    tree.wanted = false;
    tree.pins.clear();
    if (weighed?.tree === tree) weighed = null;
    release(own.revision);
  };

  const retire = (tree: Tree) => {
    if (tree.pumping) tree.resting = true;
    else letGo(tree);
  };

  const renews = (tree: Tree) => tree.base || tree.serving !== null || tree.wanted;

  const due = (tree: Tree) => (tree.pending.length > 0 || tree.pins.size > 0 || tree.wanted) && (tree.sought || !renews(tree));

  const pump = (tree: Tree): void => {
    if (tree.pumping || closed || !tree.ready || !due(tree)) return;
    tree.pumping = true;
    still();
    report(tree);
    if (tree.base) for (const other of borrowers()) report(other);
    void (async () => {
      while (!closed && trees.get(tree.key) === tree && due(tree)) {
        tree.sought = false;
        const batch = tree.pending.splice(0, tree.pending.length);
        const pins = [...tree.pins];
        tree.pins.clear();
        if (tree.base) await stepBase(batch);
        else await stepTree(tree, batch, pins);
        report(tree);
      }
    })()
      .catch((cause: unknown) => {
        if (tree.base) reports.failed(`the snapshot of ${root} could not be renewed: ${said(cause)}`);
        else refuse(tree, `the worktree could not be followed: ${said(cause)}`);
      })
      .finally(() => {
        tree.pumping = false;
        if (tree.resting) letGo(tree);
        if (weighed?.tree === tree && !tree.wanted) weighed = null;
        report(tree);
        if (tree.base) for (const other of borrowers()) report(other);
        calm();
      });
  };

  const enter = async (tree: Tree) => {
    const [mine, theirs] = await Promise.all([storeOf(tree.root), storeOf(root)]);
    if (mine !== theirs) throw new Error(`it belongs to the repository at ${mine}, and this engine serves the one at ${theirs}`);
    const [head, configs, differs, dependencies] = await Promise.all([
      headOf(tree.root),
      configsOf(tree.root),
      differencesOf(root, tree.root),
      dependenciesOf(root, tree.root),
    ]);
    if (trees.get(tree.key) !== tree) return;
    tree.head = head;
    tree.configs = configs.map((path) => join(root, path));
    tree.differs = differs;
    tree.dependencies = dependencies;
    tree.ready = true;
    report(tree);
    if (tree.pending.length > 0) pump(tree);
  };

  const detach = (checkout: string) => {
    const tree = trees.get(checkout);
    if (tree === undefined) return;
    tree.attached = false;
    if (tree.base) return;
    trees.delete(checkout);
    tree.pending.length = 0;
    tree.pins.clear();
    tree.wanted = false;
    if (weighed?.tree === tree) weighed = null;
    const own = tree.serving;
    tree.serving = null;
    for (const [revision, claimed] of [...claims]) {
      claimed.delete(checkout);
      release(revision);
    }
    if (own !== null) release(own.revision);
  };

  base.head = await headOf(root);
  base.configs = (await configsOf(root)).map((path) => join(root, path));
  const dirty = driftOf(root, base.head);
  const first = api.createSnapshot({ openProjects: [...base.configs] });
  const child = await spawned(api, first);
  const died = new Promise<never>((_, reject) => {
    child.once('exit', (code, signal) => {
      const detail = `TypeScript exited (${signal ?? code})`;
      if (!closed) reports.failed(detail);
      reject(new Error(detail));
    });
  });
  const loaded = await Promise.race([
    first.then(async (snapshot) => servedOf(base, snapshot, await makeCatalog(api, root).record(snapshot.getProjects()), base.head)),
    died,
  ]);
  const held = makeHeld(root, hashing, await dirty);
  keep(loaded);
  base.serving = loaded;
  calm();

  const grow = async (tree: Tree) => {
    if (tree.base || !tree.ready || tree.serving !== null || tree.pumping || weighed !== null) return;
    if (tree.differs.size === 0 && tree.dependencies.links === null) return;
    const ceiling = Math.min(limit, Number(process.env.GOMEMLIMIT) || Number.POSITIVE_INFINITY);
    const before = Number.isFinite(ceiling) ? await memoryOf(process.pid) : 0;
    if (before + 2 * growth > ceiling * ROOM || weighed !== null || tree.serving !== null || tree.pumping || trees.get(tree.key) !== tree)
      return;
    weighed = { tree, bytes: before };
    tree.wanted = true;
    tree.sought = true;
    pump(tree);
  };

  const seek = (tree: Tree) => {
    tree.sought = true;
    pump(tree);
    if (tree.serving !== null) return;
    base.sought = true;
    pump(base);
  };

  return {
    attach: (checkout) => {
      const standing = trees.get(checkout);
      if (standing !== undefined) {
        standing.attached = true;
        report(standing);
        return;
      }
      let real: string;
      try {
        real = realpathSync(checkout);
      } catch (cause) {
        reports.refused({ checkout, detail: `${checkout} cannot be read: ${said(cause)}` });
        return;
      }
      const tree = treeOf(checkout, real, false);
      tree.attached = true;
      trees.set(checkout, tree);
      void enter(tree).catch((cause: unknown) => refuse(tree, `${checkout} cannot be served beside ${root}: ${said(cause)}`));
    },
    detach,
    ask: async ({ checkout, revision, asked }, signal) => {
      const tree = trees.get(checkout);
      if (tree === undefined || !tree.attached) throw new Error(`the checkout ${checkout} is not served by this engine`);
      const asking = kept.get(revision);
      if (asking === undefined) throw new Error(`the snapshot ${revision} was already released`);
      const wants = asking.semantics.wants(asked);
      tree.resting = false;
      questions += 1;
      const key = String(Bun.hash(JSON.stringify(asked)));
      tree.recent.splice(0, tree.recent.length, ...latest([...tree.recent, { at: questions, key, asked, wants }]));
      answering += 1;
      still();
      try {
        const served = await settle(revision, wants);
        try {
          return await run(served, asked, signal);
        } finally {
          unuse(served.view.snapshot);
          seek(tree);
          void grow(tree).catch((cause: unknown) =>
            console.error(`the worktree ${checkout} could not weigh its own snapshot: ${said(cause)}`),
          );
        }
      } finally {
        answering -= 1;
        calm();
      }
    },
    rest: (checkout) => {
      const tree = trees.get(checkout);
      if (tree === undefined || tree.base) return;
      retire(tree);
      if (tree.pumping) return;
      report(tree);
      calm();
    },
    drop: (checkout, revision) => {
      claims.get(revision)?.delete(checkout);
      release(revision);
    },
    limit: (bytes) => {
      limit = bytes;
    },
    touch: ({ checkout, seq, touch }) => {
      const tree = trees.get(checkout);
      if (tree === undefined) return;
      const found =
        touch._tag === 'paths'
          ? null
          : touch._tag === 'head' || tree.base
            ? foundOf(tree)
            : driftOf(tree.root, (tree.serving ?? tree).head).then((paths): Found => ({
                moved: null,
                paths: [...new Set([...paths, ...tree.differs.keys()])],
              }));
      if (found !== null && tree.base) {
        drifting += 1;
        for (const other of borrowers()) report(other);
      }
      if (found !== null)
        void found.then(
          ({ paths }) => {
            reports.drifted({ checkout, seq, paths: [...paths] });
            if (!tree.base) return;
            drifting -= 1;
            unsettle(paths);
            for (const other of borrowers()) report(other);
            if (paths.some((path) => LOCKS.includes(path))) seek(base);
          },
          (cause: unknown) =>
            tree.base ? reports.failed(`the drift of ${root} could not be read: ${said(cause)}`) : refuse(tree, said(cause)),
        );
      const paths = touch._tag === 'paths' ? touch.paths : [];
      tree.pending.push({ seq, touch: touch._tag, paths, found });
      if (tree.base && unsettle(paths)) for (const other of borrowers()) report(other);
      if (tree.base && paths.some((path) => LOCKS.includes(path))) seek(base);
      else pump(tree);
    },
    close: async () => {
      closed = true;
      const quieting = quiet.close();
      await api.close();
      await quieting;
    },
  };
};
