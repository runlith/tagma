import { Effect } from 'effect';
import { and, inArray } from 'drizzle-orm';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { farEdge } from '../store/tables.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { WORK } from '../contract/wire/tags/work.js';
import { farKey } from '../contract/wire/far.js';
import { RoutedGraphs } from '../contract/service/serving.js';
import type { FarPointer } from '../contract/service/foreign.js';
import type { WorklessSpec } from '../contract/service/work.js';
import { farPointers, farStates } from '../acts/far.js';
import { openWorkOf } from './worklessSpecs.js';

const holdsWork = (pointer: FarPointer, kinds: ReadonlySet<string>): boolean =>
  kinds.has(pointer.kind) && !pointer.superseded && pointer.phase !== 'terminal';

export const withoutFarWork = Effect.fn('withoutFarWork')(function* (
  db: GraphStore['Service']['db'],
  table: TagTable,
  projectId: number,
  specs: readonly WorklessSpec[],
): Effect.fn.Return<readonly WorklessSpec[], StoreFailure> {
  if (specs.length === 0) return specs;
  const kinds = new Set(openWorkOf(table).kinds);
  const pointing = yield* farPointers(
    db,
    projectId,
    specs.map((spec) => spec.uuid),
    WORK,
  );
  const held = new Set(pointing.pointers.filter((pointer) => holdsWork(pointer, kinds)).map((pointer) => pointer.to));
  return specs.filter((spec) => !held.has(spec.uuid));
});

export const farSpecsOf = Effect.fn('farSpecsOf')(function* (
  db: GraphStore['Service']['db'],
  table: TagTable,
  ended: readonly number[],
): Effect.fn.Return<readonly WorklessSpec[], StoreFailure> {
  const pool = yield* RoutedGraphs;
  const { kinds } = openWorkOf(table);
  if (pool === null || kinds.length === 0 || ended.length === 0) return [];
  const rows = yield* db
    .select({ graph: farEdge.graph, uuid: farEdge.uuid, label: farEdge.label })
    .from(farEdge)
    .where(and(inArray(farEdge.fromId, [...ended]), inArray(farEdge.kind, [...kinds])));
  const edges = [...new Map(rows.map((row) => [farKey(row), row] as const)).values()];
  if (edges.length === 0) return [];
  const states = yield* farStates(edges, LIFECYCLE);
  const kindSet = new Set(kinds);
  const found: WorklessSpec[] = [];
  const byGraph = Map.groupBy(edges, (edge) => edge.graph);
  for (const [graph, targets] of byGraph) {
    const open = targets.flatMap((target) => {
      const state = states.get(farKey(target));
      return state?.kind === 'here' && !state.trashed && !state.superseded && (state.phase === 'initial' || state.phase === 'active')
        ? [{ uuid: target.uuid, state }]
        : [];
    });
    if (open.length === 0) continue;
    const uuids = open.map((one) => one.uuid);
    const work = yield* pool.farWork({ graph, uuids, kinds, contract: WORK });
    for (const one of open) {
      if (work.get(one.uuid) !== false) continue;
      const pointing = yield* pool.farPointing({ graph, uuids: [one.uuid], contract: WORK, excluding: one.state.project.id });
      if (pointing.pointers.some((pointer) => holdsWork(pointer, kindSet))) continue;
      found.push({ uuid: one.uuid, title: one.state.title, projectId: one.state.project.id });
    }
  }
  return found;
});
