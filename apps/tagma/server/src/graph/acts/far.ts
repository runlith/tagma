import { Effect } from 'effect';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { block, blockTag, farEdge } from '../store/tables.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import type { ContractId } from '../contract/wire/tags/behaviour.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import {
  type FarHeld,
  type FarMarks,
  type FarPointer,
  type FarPointing,
  type FarState,
  ReadFarMarks,
} from '../contract/service/foreign.js';
import { type FarEnd, type FarHold, type FarTarget, farKey, type Pointing } from '../contract/wire/far.js';
import type { BehaviourEdge } from '../contract/wire/tags/behaviour.js';
import { blockName } from '../contract/wire/references.js';
import { carriesContract, contractAt } from '../vocabulary/projection.js';

const NO_MARKS: FarMarks = { blocked: new Set(), held: [] };

const UNSERVED: FarState = {
  kind: 'absent',
  reason: 'unreadable',
  detail: 'this call reaches no graph pool, so no other project of the machine can be read',
};

export const farStates = Effect.fn('Act.farStates')(function* (
  targets: readonly FarTarget[],
  contract: ContractId,
): Effect.fn.Return<ReadonlyMap<string, FarState>, StoreFailure> {
  if (targets.length === 0) return new Map<string, FarState>();
  const pool = yield* RoutedGraphs;
  if (pool === null) return new Map(targets.map((target) => [farKey(target), UNSERVED] as const));
  return yield* pool.farStates(targets, contract);
});

const graphLabel = (target: FarTarget): string => (target.label === '' ? `graph ${target.graph.slice(0, 8)}` : target.label);

export const absentReason = (target: FarTarget, state: Exclude<FarState, { readonly kind: 'here' }>): string => {
  if (state.kind === 'ambiguous') {
    return `${state.projects.length} projects of this machine carry the graph of ${graphLabel(target)}: ${state.projects.map((one) => one.name).join(', ')}`;
  }
  if (state.reason === 'block') return `the block is not in ${state.detail ?? graphLabel(target)} on this machine`;
  if (state.reason === 'unreadable') return `${graphLabel(target)} could not be read on this machine: ${state.detail ?? 'no reason given'}`;
  return `${graphLabel(target)} is not on this machine`;
};

export const farEndOf = (target: FarTarget, state: FarState): FarEnd =>
  state.kind === 'here'
    ? { project: state.project.name, projectId: state.project.id, state: 'here', title: state.title, reason: null }
    : {
        project: state.kind === 'absent' && state.reason === 'block' && state.detail !== null ? state.detail : graphLabel(target),
        projectId: null,
        state: state.kind,
        title: null,
        reason: absentReason(target, state),
      };

export const ownRoot = Effect.fn('Act.ownRoot')(function* (db: GraphStore['Service']['db'], projectId: number) {
  const root = yield* db
    .select({ uuid: block.uuid })
    .from(block)
    .where(
      and(
        eq(block.projectId, projectId),
        isNull(block.parentId),
        isNull(block.deletedAt),
        sql`not exists (select 1 from ${blockTag} t where t.block_id = ${block.id})`,
      ),
    )
    .get();
  return root?.uuid ?? null;
});

export const farPointers = Effect.fn('Act.farPointers')(function* (
  db: GraphStore['Service']['db'],
  projectId: number,
  uuids: readonly string[] | null,
  contract: ContractId = LIFECYCLE,
): Effect.fn.Return<FarPointing, StoreFailure> {
  const pool = yield* RoutedGraphs;
  if (pool === null || uuids?.length === 0) return { pointers: [], unread: [] };
  const graph = yield* ownRoot(db, projectId);
  if (graph === null) return { pointers: [], unread: [] };
  return yield* pool.farPointing({ graph, uuids, contract, excluding: projectId });
});

export const heldGroups = (held: readonly FarHeld[]): FarHold[] => {
  const groups = new Map<string, FarHeld[]>();
  for (const one of held) {
    const group = groups.get(one.target.graph);
    if (group === undefined) groups.set(one.target.graph, [one]);
    else group.push(one);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const tasks = [...new Set(group.map((one) => blockName(one.uuid)))];
    const label = graphLabel(first.target);
    const said = tasks.length === 1 ? '1 task waits' : `${tasks.length} tasks wait`;
    return {
      project: label,
      tasks,
      code: 'target-absent' as const,
      reason: `${said} on blocks of ${label}: ${absentReason(first.target, first.state)}`,
      unblock: [
        first.state.kind === 'ambiguous'
          ? `remove_project one of ${first.state.projects.map((one) => one.name).join(', ')} — one graph, one project on a machine`
          : `add_project naming the root of a checkout of ${label} — its graph then answers here`,
        `unlink_blocks ${blockName(first.uuid)} ${first.kind} ${blockName(first.target.uuid)} — an explicit act in the graph holding the edge, seen by colleagues in git`,
      ],
    };
  });
};

export const pointingInto = Effect.fn('Act.pointingInto')(function* (
  projectId: number,
  dependencies: readonly BehaviourEdge[],
): Effect.fn.Return<{ readonly pointers: readonly FarPointer[]; readonly summary: Pointing }, StoreFailure> {
  const empty = { pointers: [], summary: { edges: 0, holding: 0, byProject: [], unread: [] } };
  const pool = yield* RoutedGraphs;
  if (pool === null) return empty;
  const root = yield* pool.graphRootOf(projectId);
  if (root.kind === 'none') return empty;
  if (root.kind === 'unread') return { pointers: [], summary: { ...empty.summary, unread: [root.project.name] } };
  const byKey = new Map<string, FarPointer>();
  const holding = new Set<FarPointer>();
  const unread = new Set<string>();
  const contracts = new Set(dependencies.map((rule) => rule.from));
  for (const contract of contracts.size === 0 ? [LIFECYCLE] : contracts) {
    const reading = yield* pool.farPointing({ graph: root.uuid, uuids: null, contract, excluding: projectId });
    for (const project of reading.unread) unread.add(project.name);
    const kinds = new Set(dependencies.flatMap((rule) => (rule.from === contract ? [rule.kind] : [])));
    for (const pointer of reading.pointers) {
      const key = `${pointer.project.id}\u0000${pointer.from}\u0000${pointer.kind}\u0000${pointer.graph}\u0000${pointer.to}`;
      const kept = byKey.get(key) ?? pointer;
      byKey.set(key, kept);
      if (kinds.has(pointer.kind) && pointer.phase === 'initial' && !pointer.superseded) holding.add(kept);
    }
  }
  const pointers = [...byKey.values()];
  const byProject = new Map<number, { project: string; projectId: number; edges: number; holding: number }>();
  for (const pointer of pointers) {
    const row = byProject.get(pointer.project.id) ?? { project: pointer.project.name, projectId: pointer.project.id, edges: 0, holding: 0 };
    row.edges += 1;
    if (holding.has(pointer)) row.holding += 1;
    byProject.set(pointer.project.id, row);
  }
  return { pointers, summary: { edges: pointers.length, holding: holding.size, byProject: [...byProject.values()], unread: [...unread] } };
});

export const holds = (state: FarState | undefined): boolean =>
  state === undefined || state.kind !== 'here' || (!state.trashed && !state.superseded && state.phase !== 'terminal');

export const measuredOnce = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(ReadFarMarks, (memo) => (memo === null ? Effect.provideService(work, ReadFarMarks, new Map()) : work));

export const farMarks = Effect.fn('Act.farMarks')(function* (
  db: GraphStore['Service']['db'],
  table: TagTable,
  projectId: number,
  among?: readonly number[],
): Effect.fn.Return<FarMarks, StoreFailure> {
  const memo = yield* ReadFarMarks;
  const known = memo?.get(projectId);
  if (known !== undefined) return known;
  const marks = yield* measureFar(db, table, projectId, memo === null ? among : undefined);
  memo?.set(projectId, marks);
  return marks;
});

const measureFar = Effect.fnUntraced(function* (
  db: GraphStore['Service']['db'],
  table: TagTable,
  projectId: number,
  among: readonly number[] | undefined,
) {
  const blocked = new Set<number>();
  const held: FarHeld[] = [];
  for (const rule of table.semanticEdges('dependency')) {
    const rows = yield* db
      .select({ id: farEdge.fromId, uuid: block.uuid, graph: farEdge.graph, target: farEdge.uuid, label: farEdge.label })
      .from(farEdge)
      .innerJoin(block, eq(block.id, farEdge.fromId))
      .where(
        and(
          eq(farEdge.kind, rule.kind),
          eq(block.projectId, projectId),
          among === undefined ? undefined : inArray(farEdge.fromId, [...among]),
          isNull(block.deletedAt),
          carriesContract(table, rule.from, block.id),
          contractAt(table, rule.from, 'initial', block.id),
        ),
      );
    if (rows.length === 0) continue;
    const targets = rows.map((row) => ({ graph: row.graph, uuid: row.target, label: row.label }));
    const states = yield* farStates(targets, rule.to);
    for (const [at, row] of rows.entries()) {
      const state = states.get(farKey(targets[at]!));
      if (!holds(state)) continue;
      blocked.add(row.id);
      if (state !== undefined && state.kind !== 'here') {
        held.push({ id: row.id, uuid: row.uuid, kind: rule.kind, target: targets[at]!, state });
      }
    }
  }
  return blocked.size === 0 ? NO_MARKS : { blocked, held };
});
