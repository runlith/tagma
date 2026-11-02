import { Effect } from 'effect';
import { aliasedTable, and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { block, edge, farEdge, unboundEdge } from '../store/tables.js';
import { farOf } from '../contract/wire/far.js';
import type { EdgeRow } from '../contract/service/acts.js';
import type { UnboundEdgeRow } from '../contract/service/blocks.js';

const FAR_COLUMNS = Object.keys(getTableColumns(farEdge)).length;
const UNBOUND_COLUMNS = Object.keys(getTableColumns(unboundEdge)).length;
const EDGE_COLUMNS = Object.keys(getTableColumns(edge)).length;
const holder = aliasedTable(block, 'unboundHolder');

export type FarRow = typeof farEdge.$inferInsert;

export type FileEdges = {
  readonly near: readonly { readonly kind: string; readonly toId: number }[];
  readonly far: readonly FarRow[];
  readonly unbound: readonly UnboundEdgeRow[];
  readonly dead: readonly string[];
};

export function fileEdges(
  fromId: number,
  edges: readonly { readonly kind: string; readonly to: string }[],
  ownRoot: string | null,
  idOf: (uuid: string) => number | undefined,
): FileEdges {
  const near: { kind: string; toId: number }[] = [];
  const far: FarRow[] = [];
  const unbound: UnboundEdgeRow[] = [];
  const dead: string[] = [];
  for (const { kind, to } of edges) {
    const address = farOf(to);
    if (address !== null && address.graph !== ownRoot) {
      far.push({
        fromId,
        kind,
        graph: address.graph,
        uuid: address.uuid,
        label: address.label,
        createdBySessionId: null,
        createdAt: new Date(0),
      });
      continue;
    }
    const toId = idOf(address?.uuid ?? to);
    if (toId === undefined) {
      dead.push(to);
      unbound.push({ fromId, kind, to: address?.uuid ?? to });
    } else near.push({ kind, toId });
  }
  return { near, far, unbound, dead };
}

export const insertFarRows = Effect.fnUntraced(function* (db: StoreDb<'graph'>, rows: readonly FarRow[]) {
  for (const page of pagesOf(rows, FAR_COLUMNS, (row) => row.kind.length + row.label.length)) {
    yield* db.insert(farEdge).values(page).onConflictDoNothing();
  }
});

export const insertUnboundRows = Effect.fnUntraced(function* (db: StoreDb<'graph'>, rows: readonly UnboundEdgeRow[]) {
  for (const page of pagesOf(rows, UNBOUND_COLUMNS, (row) => row.kind.length + row.to.length)) {
    yield* db.insert(unboundEdge).values(page).onConflictDoNothing();
  }
});

export const bindUnboundEdges = Effect.fn('Graph.bindEdges')(function* (db: StoreDb<'graph'>, projectId: number, uuids: readonly string[]) {
  const linked: EdgeRow[] = [];
  for (const page of pagesOf(uuids, 1)) {
    const rows = yield* db
      .select({ fromId: unboundEdge.fromId, toId: block.id, kind: unboundEdge.kind, to: unboundEdge.to, deletedAt: holder.deletedAt })
      .from(unboundEdge)
      .innerJoin(block, eq(block.uuid, unboundEdge.to))
      .innerJoin(holder, eq(holder.id, unboundEdge.fromId))
      .where(and(eq(block.projectId, projectId), eq(holder.projectId, projectId), inArray(unboundEdge.to, page)));
    if (rows.length === 0) continue;
    const successors = rows.filter((row) => row.kind === 'supersedes');
    const live = [...new Set(successors.filter((row) => row.deletedAt === null).map((row) => row.toId))];
    if (live.length > 0)
      yield* db
        .delete(edge)
        .where(
          and(
            eq(edge.kind, 'supersedes'),
            inArray(edge.toId, live),
            sql`${edge.fromId} in (select ${block.id} from ${block} where ${block.deletedAt} is not null)`,
          ),
        );
    const resting = [...new Set(successors.filter((row) => row.deletedAt !== null).map((row) => row.toId))];
    const standing =
      resting.length === 0
        ? []
        : yield* db
            .select({ toId: edge.toId })
            .from(edge)
            .where(and(eq(edge.kind, 'supersedes'), inArray(edge.toId, resting)));
    const claimed = new Set([...live, ...standing.map((row) => row.toId)]);
    const bound = rows
      .filter((row) => row.kind !== 'supersedes' || row.deletedAt === null || !claimed.has(row.toId))
      .map(({ fromId, toId, kind }) => ({ fromId, toId, kind, createdBySessionId: null, createdAt: new Date(0) }));
    for (const slice of pagesOf(bound, EDGE_COLUMNS, (row) => row.kind.length)) {
      linked.push(
        ...(yield* db
          .insert(edge)
          .values(slice)
          .onConflictDoNothing({ target: [edge.fromId, edge.toId, edge.kind] })
          .returning()),
      );
    }
    yield* db
      .delete(unboundEdge)
      .where(
        and(
          inArray(unboundEdge.to, [...new Set(rows.map((row) => row.to))]),
          sql`${unboundEdge.fromId} in (select ${block.id} from ${block} where ${block.projectId} = ${projectId})`,
        ),
      );
  }
  return linked;
});
