import { Context, Effect, Result } from 'effect';
import { carriedSelection, type PageKey, type PageSelection, type PageWalk } from '@runlith/paging';
import type { Caller } from '../../platform/contract/wire/caller.js';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { Blocks, Edges, type FarBlock } from '../contract/service/blocks.js';
import type { EdgeKind } from '../contract/wire/edges.js';
import type { FarAddress } from '../contract/wire/far.js';
import { blockAddress, distinctTails } from '../contract/wire/references.js';
import { BlockNames } from '../contract/service/acts.js';
import { type BlockRow } from '../contract/service/acts.js';
import type { GraphServices } from '../contract/service/services.js';
import { GateRefusal, refusalBody, type OpenRefusal, type ReferenceRefusal } from '../../platform/contract/wire/refusal.js';
import { Tags } from '../contract/service/vocabulary.js';
import { OtherGraphs } from '../serving/policy.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { SourceProject } from '../contract/service/source.js';
import { CurrentGraph, GraphCall, MeasuredCheckout, RoutedGraphs } from '../contract/service/serving.js';
import { CallerAim } from '../../platform/contract/service/place.js';
import type { Place } from '../../platform/contract/wire/place.js';
import { OBSERVATION } from '../contract/wire/tags/observation.js';
import type { SelectorRefusal } from '../serving/selector.js';
import { projectOrNone } from '../serving/current.js';
import type { CopyFailure, UnreachableProject } from '../contract/wire/answers.js';
import { refusal } from '../serving/refusal.js';
import { ambiguousAcross } from '../serving/ambiguity.js';

export type CrossingRefusal = ReferenceRefusal | OpenRefusal | SelectorRefusal | 'place-mismatch' | 'not-found';

export type PlacedSelection = { readonly projectId?: number | undefined; readonly checkout?: string | null | undefined };

const observes = Effect.fn('crossing.observes')(function* (homeId: number, row: { readonly tags: readonly string[] }) {
  return (yield* (yield* Tags).of(homeId)).supports(row, OBSERVATION);
});

type Elsewhere = {
  readonly graph: Context.Context<GraphServices | GraphStore>;
  readonly row: BlockRow;
};

type ElsewhereReading = { readonly hit: Elsewhere | undefined; readonly unreachable: readonly UnreachableProject[] };

type Holding = { readonly canonical: boolean; readonly checkout: string; readonly blocks: ReadonlySet<string> };

const indexHolding = Effect.fn('crossing.indexHolding')(function* (
  name: string,
  projectIds: readonly number[],
  excluding: string | undefined,
) {
  const pool = yield* RoutedGraphs;
  if (pool === null) return null;
  const reading = yield* pool.titles({ projectIds, names: [name], ...(excluding === undefined ? {} : { excluding }) });
  const holding = new Map<number, Holding>();
  const hold = (projectId: number, canonical: boolean, checkout: string, uuid: string | null) => {
    const known = holding.get(projectId);
    const blocks = new Set(known?.blocks);
    if (uuid !== null) blocks.add(uuid);
    const better =
      known === undefined ||
      (uuid !== null && known.blocks.size === 0) ||
      (canonical && !known.canonical && (uuid !== null || known.blocks.size === 0));
    const kept = better ? { canonical, checkout } : known;
    holding.set(projectId, { canonical: kept.canonical, checkout: kept.checkout, blocks });
  };
  for (const row of reading.titles) hold(row.projectId, row.canonical, row.checkout, row.uuid);
  for (const copy of reading.unindexed) if (copy.canonical) hold(copy.projectId, true, copy.checkout, null);
  for (const copy of reading.unreadable) if (copy.branch === null) hold(copy.projectId, true, copy.checkout, null);
  return holding;
});

const elsewhere = Effect.fn('crossing.elsewhere')(function* (
  name: string,
  trashed: BlockRow | null,
): Effect.fn.Return<ElsewhereReading, GateRefusal<CrossingRefusal> | StoreFailure, GraphServices | GraphCall> {
  const unreachable: UnreachableProject[] = [];
  const reach = yield* OtherGraphs;
  if (reach === null) return { hit: undefined, unreachable };
  const projects = yield* Projects;
  const call = yield* yield* GraphCall;
  const global = yield* projects.global();
  const listed = yield* projects.list();
  const asked = blockAddress(name);
  const apart = (projectId: number) => trashed === null || projectId !== trashed.projectId;
  const targets = (global === undefined || listed.some((project) => project.id === global.id) ? listed : [...listed, global]).filter(
    (project) => (asked.projectId === null || project.id === asked.projectId) && apart(project.id),
  );
  let fallback: Elsewhere | undefined;
  const live = (hit: Elsewhere | undefined) => {
    if (hit === undefined || hit.row.deletedAt === null) return hit;
    if (trashed === null) fallback ??= hit;
    return undefined;
  };
  const current = yield* CurrentGraph;
  const pool = yield* RoutedGraphs;
  const holding = yield* indexHolding(
    asked.name,
    targets.flatMap((project) => (project.id === call.project.id && current === null ? [] : [project.id])),
    current?.layout.treeRoot,
  );
  const ambiguity = (projectId: number) => {
    const copy = holding?.get(projectId);
    return copy === undefined || copy.blocks.size < 2
      ? undefined
      : new GateRefusal('ambiguous-name', `${name} names ${copy.blocks.size} blocks in project ${projectId}`, [
          'write more of the name — the tail is what tells them apart',
          ...distinctTails([...copy.blocks]),
        ]);
  };
  const open = (projectId: number) => {
    const copy = holding?.get(projectId);
    if (pool === null || copy === undefined || (copy.canonical && projectId !== call.project.id)) return reach(projectId);
    return Effect.map(pool.resolve({ projectId, cwd: copy.checkout }), (served) => served.context);
  };
  const visited = new Map<number, Result.Result<Elsewhere | undefined, GateRefusal<CrossingRefusal>>>();
  const rejectProject = (projectId: number, error: GateRefusal) => {
    visited.set(projectId, Result.succeed(undefined));
    unreachable.push({
      projectId,
      error: refusalBody(error),
    });
  };
  const read = Effect.fn('crossing.readProject')(function* (projectId: number) {
    const known = visited.get(projectId);
    if (known !== undefined) {
      if (Result.isFailure(known)) return yield* known.failure;
      return known.success;
    }
    if (holding !== null && !holding.has(projectId)) {
      visited.set(projectId, Result.succeed(undefined));
      return undefined;
    }
    const ambiguous = ambiguity(projectId);
    if (ambiguous !== undefined) {
      visited.set(projectId, Result.fail(ambiguous));
      return yield* ambiguous;
    }
    const opened = yield* Effect.result(open(projectId));
    if (Result.isFailure(opened)) {
      rejectProject(projectId, opened.failure);
      return undefined;
    }
    const graph = opened.success;
    const named = yield* Effect.provide(
      Effect.flatMap(BlockNames, (names) => Effect.result(names.idOfName(name))),
      graph,
    );
    if (Result.isFailure(named)) {
      const error = refusal(named.failure);
      if (error.code === 'ambiguous-name' || error.code === 'bad-name') {
        visited.set(projectId, Result.fail(error));
        return yield* error;
      }
      if (error.code === 'not-found') visited.set(projectId, Result.succeed(undefined));
      else rejectProject(projectId, error);
      return undefined;
    }
    const read = yield* Effect.provide(
      Effect.flatMap(Blocks, (blocks) => Effect.result(blocks.rawBlockById(named.success))),
      graph,
    );
    if (Result.isFailure(read)) {
      rejectProject(projectId, refusal(read.failure));
      return undefined;
    }
    const hit = read.success.projectId === projectId ? { graph, row: read.success } : undefined;
    visited.set(projectId, Result.succeed(hit));
    return hit;
  });
  const sourceCheckoutHit = Effect.fn('crossing.sourceCheckoutHit')(function* (projectId: number, rootPath: string) {
    const current = yield* CurrentGraph;
    const pool = yield* RoutedGraphs;
    if (current === null || pool === null) return undefined;
    const opened = yield* Effect.result(pool.resolve({ projectId, cwd: rootPath }));
    if (Result.isFailure(opened)) {
      rejectProject(projectId, opened.failure);
      return undefined;
    }
    if (opened.success.checkout === current.checkout) return undefined;
    const graph = opened.success.context;
    const named = yield* Effect.result(
      Effect.provide(
        Effect.flatMap(BlockNames, (names) => names.idOfName(name)),
        graph,
      ),
    );
    if (Result.isFailure(named)) {
      const error = refusal(named.failure);
      if (error.code === 'ambiguous-name' || error.code === 'bad-name') return yield* error;
      if (error.code !== 'not-found') rejectProject(projectId, error);
      return undefined;
    }
    const read = yield* Effect.result(
      Effect.provide(
        Effect.flatMap(Blocks, (blocks) => blocks.rawBlockById(named.success)),
        graph,
      ),
    );
    if (Result.isFailure(read)) {
      rejectProject(projectId, refusal(read.failure));
      return undefined;
    }
    const row = read.success;
    if (row.projectId !== projectId) return undefined;
    const observed = yield* Effect.result(Effect.provide(observes(projectId, row), graph));
    if (Result.isFailure(observed)) {
      rejectProject(projectId, refusal(observed.failure));
      return undefined;
    }
    return observed.success ? ({ graph, row } satisfies Elsewhere) : undefined;
  });
  const home = yield* (yield* SourceProject).project();
  if (home !== undefined && home.id === call.project.id && apart(home.id)) {
    const hit = live(yield* sourceCheckoutHit(home.id, home.rootPath));
    if (hit !== undefined) return { hit, unreachable };
  }
  if (holding?.has(call.project.id) === true && apart(call.project.id)) {
    const own = live(yield* read(call.project.id));
    if (own !== undefined) return { hit: own, unreachable };
  }
  if (call.lens.names !== 'every-served-project') {
    if (home !== undefined && home.id !== call.project.id && apart(home.id)) {
      const found = yield* Effect.result(read(home.id));
      if (Result.isFailure(found)) {
        if (found.failure.code !== 'ambiguous-name') return yield* found.failure;
      } else if (found.success !== undefined) {
        const hit = found.success;
        const observed = yield* Effect.result(Effect.provide(observes(home.id, hit.row), hit.graph));
        if (Result.isFailure(observed)) rejectProject(home.id, refusal(observed.failure));
        else if (observed.success && live(hit) !== undefined) return { hit, unreachable };
      }
    }
    if (global !== undefined && global.id !== call.project.id && apart(global.id)) {
      const hit = live(yield* read(global.id));
      if (hit !== undefined) return { hit, unreachable };
    }
  }
  const hits: Elsewhere[] = [];
  for (const project of targets) {
    if (project.id === call.project.id) continue;
    const hit = yield* read(project.id);
    if (hit !== undefined) hits.push(hit);
  }
  const living = hits.filter((hit) => hit.row.deletedAt === null);
  const chosen = living.length > 0 || trashed !== null ? living : fallback === undefined ? hits : [fallback];
  if (chosen.length < 2) return { hit: chosen[0], unreachable };
  return yield* ambiguousAcross(
    name,
    chosen.map(({ row }) => row),
  );
});

export type GraphTarget = {
  readonly projectId: number;
  readonly graph: Context.Context<GraphServices | GraphStore> | null;
  readonly unreachable?: readonly UnreachableProject[];
};

type Target = GraphTarget & {
  readonly name: string;
  readonly row: BlockRow;
};

type Resolutions = Map<BlockNames['Service'], Map<string, Target>>;

const ResolvedNames = Context.Reference<Resolutions | null>('tagma/graph/ResolvedNames', { defaultValue: () => null });

export const crossingCall = () => Context.make(ResolvedNames, new Map<BlockNames['Service'], Map<string, Target>>());

const findTarget = Effect.fn('crossing.findTarget')(function* (
  name: string,
): Effect.fn.Return<Target, GateRefusal<CrossingRefusal> | StoreFailure, GraphServices | GraphCall> {
  const blocks = yield* Blocks;
  const named = yield* BlockNames;
  const call = yield* yield* GraphCall;
  const local = yield* Effect.result(named.idOfName(name));
  if (Result.isSuccess(local)) {
    const row = yield* blocks.rawBlockById(local.success);
    const moved = row.deletedAt === null ? null : yield* elsewhere(name, row);
    const unreachable = moved?.unreachable ?? [];
    const living = moved?.hit;
    if (living !== undefined) return { name, row: living.row, projectId: living.row.projectId, graph: living.graph, unreachable };
    const reach = yield* OtherGraphs;
    const graph = row.projectId === call.project.id || reach === null ? null : yield* reach(row.projectId);
    if (graph === null) return { name, row, projectId: row.projectId, graph, unreachable };
    const home = yield* Effect.provide(
      Effect.gen(function* () {
        const id = yield* (yield* BlockNames).idOfName(row.uuid);
        return yield* (yield* Blocks).rawBlockById(id);
      }),
      graph,
    );
    return { name, row: home, projectId: home.projectId, graph, unreachable };
  }
  if (!(local.failure instanceof GateRefusal) || local.failure.code !== 'not-found') return yield* local.failure;
  const there = yield* elsewhere(name, null);
  if (there.hit === undefined) {
    if (there.unreachable.length === 0) return yield* local.failure;
    return yield* new GateRefusal(
      'graph-pool',
      `${name} could not be resolved across these unreachable projects:\n${there.unreachable.map((copy) => `project ${copy.projectId}: ${copy.error.code}: ${copy.error.reason}`).join('\n')}`,
      ['repair the named projects, then retry this name', ...there.unreachable.flatMap((copy) => copy.error.unblock)],
    );
  }
  return { name, row: there.hit.row, projectId: there.hit.row.projectId, graph: there.hit.graph, unreachable: there.unreachable };
});

export const locate = Effect.fn('crossing.locate')(function* (name: string) {
  const resolutions = yield* ResolvedNames;
  const resolver = yield* BlockNames;
  let names = resolutions?.get(resolver);
  const known = names?.get(name);
  if (known !== undefined) return known;
  const target = yield* findTarget(name);
  if (resolutions !== null) {
    if (names === undefined) resolutions.set(resolver, (names = new Map()));
    names.set(name, target);
  }
  return target;
});

const placeOf = Effect.fn('crossing.placeOf')(function* (
  target: GraphTarget,
): Effect.fn.Return<Place, GateRefusal<CrossingRefusal> | StoreFailure, GraphServices> {
  const current = yield* CurrentGraph;
  const measured = target.graph === null ? yield* MeasuredCheckout : Context.get(target.graph, MeasuredCheckout);
  const checkout =
    measured?.projectId === target.projectId ? measured.path : current?.projectId === target.projectId ? current.checkout : null;
  const pool = yield* RoutedGraphs;
  const branch =
    current?.projectId === target.projectId && current.checkout === checkout
      ? ((yield* CallerAim)?.branch ?? null)
      : pool === null || checkout === null
        ? null
        : ((yield* pool.branches(target.projectId)).find((row) => row.worktree === checkout && !row.canonical)?.branch ?? null);
  return { projectId: target.projectId, checkout, branch };
});

export const blockPlace = (name: string) => Effect.flatMap(locate(name), placeOf);

export const reflectionPlace = Effect.fn('crossing.reflectionPlace')(function* () {
  const home = yield* (yield* SourceProject).project();
  if (home === undefined)
    return yield* new GateRefusal('no-home', 'no registered project covers the running server’s own source', [
      'register the checkout the server runs from as a project',
    ]);
  return { projectId: home.id, checkout: home.rootPath, branch: null };
});

export const atTarget = <A, E, R>(target: GraphTarget, work: Effect.Effect<A, E, R>) =>
  Effect.flatMap(ResolvedNames, (names) =>
    target.graph === null ? work : Effect.provide(Effect.provideService(work, ResolvedNames, names), target.graph),
  );

type PreparedTargets<F> = {
  readonly resolution: Result.Result<
    { readonly targets: readonly Target[]; readonly selected: GraphTarget | null },
    GateRefusal<CrossingRefusal> | StoreFailure
  >;
  readonly facts: F | null;
  readonly unreachable: readonly UnreachableProject[];
  readonly copyFailures: readonly CopyFailure[];
};

export const targeted = <Input, A, E, R, F = null, EF = never, RF = never>(
  namesOf: (input: Input) => string | readonly string[] | undefined,
  work: (input: Input, projectId: number | undefined, caller: Caller, facts: F | null) => Effect.Effect<A, E, R>,
  facts?: (row: BlockRow) => Effect.Effect<F, EF, RF>,
) => ({
  prepare: Effect.fnUntraced(function* (
    input: Input,
  ): Effect.fn.Return<
    PreparedTargets<F>,
    E | EF | GateRefusal<CrossingRefusal> | StoreFailure,
    R | RF | GraphServices | GraphCall | GraphStore
  > {
    const named = namesOf(input);
    const names = named === undefined ? [] : typeof named === 'string' ? [named] : [...new Set(named)];
    const resolution = yield* Effect.result(
      Effect.gen(function* () {
        const targets = yield* Effect.forEach(names, locate);
        const current = targets.length === 0 ? yield* projectOrNone : undefined;
        const selected = targets[0] ?? (current === undefined ? null : { projectId: current.project.id, graph: null });
        return { targets, selected };
      }),
    );
    const first = Result.isSuccess(resolution) ? resolution.success.targets[0] : undefined;
    const frame = yield* CurrentGraph;
    return {
      resolution,
      facts: facts === undefined || first === undefined ? null : yield* atTarget(first, facts(first.row)),
      copyFailures: frame === null ? [] : yield* frame.copyFailures(),
      unreachable: Result.isSuccess(resolution)
        ? [
            ...new Map(
              resolution.success.targets.flatMap((target) => (target.unreachable ?? []).map((copy) => [copy.projectId, copy] as const)),
            ).values(),
          ]
        : [],
    };
  }),
  execute: Effect.fnUntraced(function* (
    input: Input,
    prepared: PreparedTargets<F>,
    caller: Caller,
  ): Effect.fn.Return<A, E | GateRefusal<CrossingRefusal> | StoreFailure, R | GraphServices | GraphCall | GraphStore> {
    if (Result.isFailure(prepared.resolution)) return yield* prepared.resolution.failure;
    const here = yield* Effect.context<GraphServices | GraphStore>();
    const { selected } = prepared.resolution.success;
    const targets = prepared.resolution.success.targets.map((target) => (target.graph === null ? { ...target, graph: here } : target));
    const workHere = work(input, selected?.projectId, caller, prepared.facts);
    const running = selected === null ? workHere : atTarget(selected, workHere);
    const resolver = Context.get(selected?.graph ?? here, BlockNames);
    return yield* Effect.provideService(
      running,
      ResolvedNames,
      new Map([[resolver, new Map(targets.map((target) => [target.name, target]))]]),
    );
  }),
  report: <Answer extends object>(answer: Answer, prepared: PreparedTargets<F>): Answer =>
    prepared.unreachable.length === 0 && prepared.copyFailures.length === 0
      ? answer
      : {
          ...answer,
          unreachable: prepared.unreachable.length === 0 ? undefined : prepared.unreachable,
          copyFailures: prepared.copyFailures.length === 0 ? undefined : prepared.copyFailures,
        },
});

export const scoped = (name: string) => cross(name, (id) => Effect.flatMap(Blocks, (blocks) => blocks.blockById(id)));

export type LinkTarget = { readonly near: number } | { readonly far: FarBlock };

export const linkTarget = Effect.fn('crossing.linkTarget')(function* (name: string, owner: { readonly projectId: number }, kind: EdgeKind) {
  const target = yield* locate(name);
  if (target.projectId === owner.projectId) {
    const near: LinkTarget = { near: (yield* scoped(name)).id };
    return near;
  }
  const far: LinkTarget = {
    far: yield* atTarget(
      target,
      Effect.gen(function* () {
        const row = yield* (yield* Blocks).blockById(target.row.id);
        return yield* (yield* Edges).farBlockOf(row, kind);
      }),
    ),
  };
  return far;
});

export const farAddressOf = Effect.fn('crossing.farAddressOf')(function* (target: Target) {
  const root = yield* atTarget(
    target,
    Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(target.projectId)),
  );
  const address: FarAddress = { graph: root.uuid, uuid: target.row.uuid };
  return address;
});

export const peer = <const Code extends string>(name: string, owner: BlockRow, code: Code) =>
  Effect.flatMap(scoped(name), (row) =>
    row.projectId === owner.projectId
      ? Effect.succeed(row)
      : Effect.fail(
          new GateRefusal(code, 'this act cannot join blocks stored in different project graphs', [
            `name a block in project ${owner.projectId}, beside the block being changed`,
          ]),
        ),
  );

export const cross = <A, E, R>(
  name: string,
  work: (id: number) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | GateRefusal<CrossingRefusal> | StoreFailure, R | GraphServices | GraphCall> =>
  Effect.flatMap(locate(name), (target) => atTarget(target, work(target.row.id)));

export const currentTarget = Effect.map(Effect.flatten(GraphCall), (call): GraphTarget => ({ projectId: call.project.id, graph: null }));
