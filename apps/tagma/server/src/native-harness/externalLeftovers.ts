import { eq, type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import { MachineStore, type StoreDb } from '../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { threadCompactionCheckpoint, threadHistoryItem, threadLog, threadPrunedToolCall } from './store/thread.js';
import { runRows, thread, threadEntry, threadRun } from '../threads/store/kernel.js';
import { threadRecord } from '../thread-record/store/table.js';
import { threadBase, threadEvent } from '../threads/store/journal.js';
import { payloadField } from '../threads/store/fields.js';

const CHILDREN = [threadLog, threadEntry, threadHistoryItem, threadCompactionCheckpoint, threadPrunedToolCall, threadRun];

const holding = (id: SQL | SQLiteColumn): SQL =>
  sql.join(
    CHILDREN.map((child) => sql`exists (select 1 from ${child} where ${child.threadId} = ${id})`),
    sql` or `,
  );

const restorable = (id: string): SQL => sql`${threadEvent.threadId} = ${id}
  and ${payloadField(threadEvent.payload, 'bodyInFold')} is not null
  and exists (select 1 from ${threadEntry} f where f.thread_id = ${id} and f.entry_id = ${payloadField(threadEvent.payload, 'entry.id')})`;

const clearOne = Effect.fnUntraced(function* (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string) {
  if (yield* unit.run(db.select({ id: thread.id }).from(thread).where(eq(thread.id, id)).get())) return;
  yield* unit.run(
    db
      .update(threadEvent)
      .set({
        payload: sql`(select json_set(json_remove(${threadEvent.payload}, '$.bodyInFold'), '$.entry', json(f.entry))
          from ${threadEntry} f where f.thread_id = ${id} and f.entry_id = ${payloadField(threadEvent.payload, 'entry.id')}
          order by f.ord desc limit 1)`,
      })
      .where(restorable(id)),
  );
  for (const child of CHILDREN) yield* unit.run(db.delete(child).where(eq(child.threadId, id)));
  const left = yield* unit.run(
    db.get<{ held: number; stubs: number }>(
      sql`select (${holding(sql`${id}`)}) as held, exists (select 1 from ${threadEvent} where ${restorable(id)}) as stubs`,
    ),
  );
  if (left !== undefined && (left.held === 1 || left.stubs === 1)) {
    return yield* Effect.die(new Error(`External thread ${id} still holds native rows after its leftovers were cleared.`));
  }
});

export const clearExternalLeftovers = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const pending = yield* units.read((unit) =>
    unit.run(
      db.select({ id: threadRecord.id }).from(threadRecord).where(sql`${threadRecord.harness} <> 'tagma'
          and not exists (select 1 from ${thread} where ${thread.id} = ${threadRecord.id})
          and not exists (select 1 from ${threadBase} where ${threadBase.sourceId} = ${threadRecord.id})
          and (${holding(threadRecord.id)})`),
    ),
  );
  for (const { id } of pending) {
    yield* units.write(writes('threads.clearExternalLeftovers', [threadEvent, ...CHILDREN, runRows]), (unit) => clearOne(db, unit, id));
  }
  return pending.length;
});
