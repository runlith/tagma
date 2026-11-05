import { and, desc, eq } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import type { ThreadDeletion } from '@runlith/agent/collaboration/threads';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';

export const threadDeletion = sqliteTable(
  'thread_deletion',
  {
    threadId: text('thread_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    spawnRootId: text('spawn_root_id').notNull(),
    name: text('name'),
    by: text('by').notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('thread_deletion_name_idx').on(table.ownerId, table.spawnRootId, table.name, table.deletedAt)],
);

type DeletionRow = typeof threadDeletion.$inferInsert;

const recording = writes('ThreadDeletions.record', [threadDeletion]);

const deletionOf = (row: typeof threadDeletion.$inferSelect): ThreadDeletion => ({
  threadId: row.threadId,
  name: row.name,
  by: row.by,
  at: row.deletedAt.toISOString(),
});

export const makeDeletionRecords = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return {
    record: (rows: readonly DeletionRow[]) =>
      rows.length === 0
        ? Effect.void
        : units.write(recording, (unit) =>
            Effect.forEach(
              rows,
              (row) =>
                unit.run(
                  db
                    .insert(threadDeletion)
                    .values(row)
                    .onConflictDoUpdate({ target: threadDeletion.threadId, set: { by: row.by, deletedAt: row.deletedAt } }),
                ),
              { discard: true },
            ),
          ),
    find: (ownerId: string, spawnRootId: string, address: string) =>
      units.read((unit) =>
        Effect.gen(function* () {
          const byId = yield* unit.run(
            db
              .select()
              .from(threadDeletion)
              .where(and(eq(threadDeletion.threadId, address), eq(threadDeletion.ownerId, ownerId)))
              .get(),
          );
          if (byId !== undefined) return deletionOf(byId);
          const byName = yield* unit.run(
            db
              .select()
              .from(threadDeletion)
              .where(
                and(eq(threadDeletion.ownerId, ownerId), eq(threadDeletion.spawnRootId, spawnRootId), eq(threadDeletion.name, address)),
              )
              .orderBy(desc(threadDeletion.deletedAt))
              .limit(1)
              .get(),
          );
          return byName === undefined ? null : deletionOf(byName);
        }),
      ),
  };
});

export type DeletionRecords = Effect.Success<typeof makeDeletionRecords>;
