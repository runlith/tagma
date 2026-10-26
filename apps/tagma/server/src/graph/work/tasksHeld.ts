import { type Context, Effect } from 'effect';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chunk } from '@runlith/utils/collection';
import { rowsPerStatement } from '../../platform/store/binds.js';
import type { GraphStore, StoreFailure } from '../../platform/contract/service/store.js';
import { block } from '../store/tables.js';
import { session } from '../../platform/store/writers.js';
import type { TagTable } from '../contract/wire/tags/table.js';
import { blockName } from '../contract/wire/references.js';
import type { HeldTask } from '../contract/service/serving.js';
import { WORK } from '../contract/wire/tags/work.js';
import { HOLDER, HOLDER_SLOT } from '../contract/wire/tags/holder.js';
import { carriesContract, contractAt, slotValue } from '../vocabulary/projection.js';

export function heldTasks(
  table: TagTable,
  graph: Context.Service.Shape<typeof GraphStore>,
  projectId: number,
  threadIds: readonly string[],
): Effect.Effect<ReadonlyMap<string, readonly HeldTask[]>, StoreFailure> {
  if (threadIds.length === 0) return Effect.succeed(new Map());
  const fixed =
    2 +
    table.typesSupporting(WORK).length +
    table.slotFields(HOLDER, HOLDER_SLOT).length * 2 +
    table.wordsAt(WORK, 'active').reduce((count, words) => count + 2 + words.words.length, 0);
  const size = Math.max(1, rowsPerStatement(1) - fixed);
  return Effect.gen(function* () {
    const held = new Map<string, HeldTask[]>();
    for (const ids of chunk([...new Set(threadIds)], size)) {
      const rows = yield* graph.db
        .select({ threadId: session.key, uuid: block.uuid, title: block.title })
        .from(block)
        .innerJoin(session, eq(sql`cast(${slotValue(table, HOLDER, HOLDER_SLOT, block.id)} as integer)`, session.id))
        .where(
          and(
            eq(block.projectId, projectId),
            carriesContract(table, WORK, block.id),
            contractAt(table, WORK, 'active', block.id),
            isNull(block.deletedAt),
            eq(session.harness, 'tagma'),
            inArray(session.key, ids),
          ),
        )
        .orderBy(block.title, block.uuid);
      for (const row of rows) {
        const current = held.get(row.threadId) ?? [];
        current.push({ name: blockName(row.uuid), title: row.title });
        held.set(row.threadId, current);
      }
    }
    return held as ReadonlyMap<string, readonly HeldTask[]>;
  });
}
