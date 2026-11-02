import { aliasedTable, and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { Effect } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { block, edge, farEdge, source, unboundEdge } from '../store/tables.js';
import { farText } from '../contract/wire/far.js';
import type { Tagged } from '../contract/wire/tags/roles.js';
import { Tags } from '../contract/service/vocabulary.js';
import { type BlockConnections, type ConnectionRows, groupConnections } from './export.js';
import { spelledSessions } from './sessions.js';

const holder = aliasedTable(block, 'connectionHolder');
const target = aliasedTable(block, 'connectionTarget');

export type ConnectedRow = Tagged & { readonly id: number };

export const connectionRows = Effect.fnUntraced(function* (
  projectId: number,
  rows: readonly ConnectedRow[],
  scope: 'alive' | 'named',
): Effect.fn.Return<ConnectionRows, StoreFailure, GraphStore | Tags> {
  if (scope === 'named' && rows.length === 0) return { edges: [], sources: [], sessions: [] };
  const { db } = yield* GraphStore;
  const named = scope === 'alive' ? [] : [...new Set(rows.map((row) => row.id))];
  const held = scope === 'alive' ? and(eq(holder.projectId, projectId), isNull(holder.deletedAt)) : inArray(holder.id, named);
  const edges = yield* db
    .select({ fromId: edge.fromId, kind: edge.kind, to: target.uuid })
    .from(edge)
    .innerJoin(holder, eq(holder.id, edge.fromId))
    .innerJoin(target, eq(target.id, edge.toId))
    .where(and(held, eq(target.projectId, projectId), isNotNull(target.uuid)))
    .unionAll(
      db
        .select({ fromId: unboundEdge.fromId, kind: unboundEdge.kind, to: unboundEdge.to })
        .from(unboundEdge)
        .innerJoin(holder, eq(holder.id, unboundEdge.fromId))
        .where(and(held, eq(holder.projectId, projectId))),
    );
  const far = yield* db
    .select({ fromId: farEdge.fromId, kind: farEdge.kind, graph: farEdge.graph, uuid: farEdge.uuid, label: farEdge.label })
    .from(farEdge)
    .innerJoin(holder, eq(holder.id, farEdge.fromId))
    .where(and(held, eq(holder.projectId, projectId)));
  const sources = yield* db
    .select({ blockId: source.blockId, kind: source.kind, ref: source.ref, symbol: source.symbol })
    .from(source)
    .innerJoin(holder, eq(holder.id, source.blockId))
    .where(and(held, eq(holder.projectId, projectId)))
    .orderBy(asc(source.id));
  const sessions = yield* spelledSessions(yield* (yield* Tags).of(projectId), rows);
  return { edges: [...edges, ...far.map((row) => ({ fromId: row.fromId, kind: row.kind, to: farText(row) }))], sources, sessions };
});

export const connectionsOf = (
  projectId: number,
  rows: readonly ConnectedRow[],
): Effect.Effect<BlockConnections, StoreFailure, GraphStore | Tags> =>
  Effect.map(connectionRows(projectId, rows, 'named'), groupConnections);
