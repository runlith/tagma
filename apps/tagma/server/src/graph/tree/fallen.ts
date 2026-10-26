import { Effect } from 'effect';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { block, edge, event, farEdge, source, touch } from '../store/tables.js';
import type { Act, BlockProjection } from '../contract/service/acts.js';

export type Fallen = { readonly id: number; readonly parentId: number | null };

const childrenOf = (rows: readonly Fallen[]): Map<number, number[]> => {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const group = children.get(row.parentId);
    if (group === undefined) children.set(row.parentId, [row.id]);
    else group.push(row.id);
  }
  return children;
};

const subtree = (children: ReadonlyMap<number, readonly number[]>, top: number): number[] => {
  const ids: number[] = [];
  const stack = [top];
  while (stack.length > 0) {
    const id = stack.pop() as number;
    ids.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return ids;
};

export const recordTrash = Effect.fn('Mirror.recordTrash')(function* (act: Act['Service'], fallen: readonly Fallen[], at: Date) {
  const falling = new Set(fallen.map((row) => row.id));
  const children = childrenOf(fallen);
  for (const row of fallen) {
    if (row.parentId !== null && falling.has(row.parentId)) continue;
    yield* act.record('delete', row.id, { ids: subtree(children, row.id) }, at);
  }
});

export const rebatch = Effect.fn('Mirror.rebatch')(function* (
  db: StoreDb<'graph'>,
  act: Act['Service'],
  projectId: number,
  revived: readonly number[],
  at: Date,
) {
  if (revived.length === 0) return;
  const trashed = yield* db
    .select({ id: block.id, parentId: block.parentId })
    .from(block)
    .where(and(eq(block.projectId, projectId), sql`${block.deletedAt} is not null`));
  const children = childrenOf(trashed);
  for (const id of revived) {
    for (const child of children.get(id) ?? []) yield* act.record('delete', child, { ids: subtree(children, child) }, at);
  }
});

export const purgeUnjournaled = Effect.fn('Mirror.purgeUnjournaled')(function* (
  db: StoreDb<'graph'>,
  projection: BlockProjection['Service'],
  projectId: number,
) {
  const journaled = new Set(
    (yield* db.all<{ id: number }>(
      sql`select distinct j.value as id from ${event} ev, json_each(ev.payload, '$.ids') j where ev.op = 'delete'`,
    )).map((row) => row.id),
  );
  const loose = (yield* db
    .select({ id: block.id })
    .from(block)
    .where(and(eq(block.projectId, projectId), sql`${block.deletedAt} is not null`)))
    .map((row) => row.id)
    .filter((id) => !journaled.has(id));
  yield* projection.discard(loose);
  const step = rowsPerStatement(1);
  for (let at = 0; at < loose.length; at += step) {
    const ids = loose.slice(at, at + step);
    yield* db.delete(touch).where(inArray(touch.taskId, ids));
    yield* db.delete(source).where(inArray(source.blockId, ids));
    yield* db.delete(edge).where(inArray(edge.fromId, ids));
    yield* db.delete(edge).where(inArray(edge.toId, ids));
    yield* db.delete(farEdge).where(inArray(farEdge.fromId, ids));
    yield* db.delete(block).where(inArray(block.id, ids));
  }
});
