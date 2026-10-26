import { Effect } from 'effect';
import { getTableColumns } from 'drizzle-orm';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import { farEdge } from '../store/tables.js';
import { farOf } from '../contract/wire/far.js';

const FAR_COLUMNS = Object.keys(getTableColumns(farEdge)).length;

export type FarRow = typeof farEdge.$inferInsert;

export type FileEdges = {
  readonly near: readonly { readonly kind: string; readonly toId: number }[];
  readonly far: readonly FarRow[];
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
    if (toId === undefined) dead.push(to);
    else near.push({ kind, toId });
  }
  return { near, far, dead };
}

export const insertFarRows = Effect.fnUntraced(function* (db: StoreDb<'graph'>, rows: readonly FarRow[]) {
  for (const page of pagesOf(rows, FAR_COLUMNS, (row) => row.kind.length + row.label.length)) {
    yield* db.insert(farEdge).values(page).onConflictDoNothing();
  }
});
