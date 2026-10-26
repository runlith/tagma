import { Effect } from 'effect';
import { eq, sql } from 'drizzle-orm';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadConversation } from '../store/conversation.js';
import { conversationWrites, threadBase, threadEvent, threadRolloutCursor } from '../store/journal.js';
import { journalHead } from './base.js';
import {
  CONVERSATION_KINDS,
  conversationCarried,
  conversationCleared,
  conversationSettled,
  conversationSkipped,
  conversationUnreadable,
  type IndexedEvent,
} from './conversationIndex.js';
import type { SqliteThreadJournal } from './log.js';

//! One read takes every said event of a rested thread, so a packed rollout is unpacked once per pass.
const READ = Number.MAX_SAFE_INTEGER;
//! A thread in SQL is read a page at a time, so a long conversation never lands on the loop whole.
const PAGE = 256;
//! One batch is one write unit, so it stays small enough that a live append never waits behind it for long.
const BATCH = 64;

const filling = writes('ConversationBackfill.batch', [], conversationWrites);

type Standing = {
  readonly rested: boolean;
  readonly through: number;
  readonly unreadable: boolean;
  readonly low: number | null;
  readonly logged: number | null;
  readonly filed: number | null;
};

export type ConversationBackfill = Effect.Success<ReturnType<typeof makeConversationBackfill>>;

export const makeConversationBackfill = Effect.fnUntraced(function* ({ journal }: { readonly journal: SqliteThreadJournal }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const standingOf = (threadId: string): Effect.Effect<Standing, StoreFailure> =>
    Effect.map(
      units.read((unit) =>
        unit.run(
          db.all<{
            readonly through: number | null;
            readonly unreadable: number | null;
            readonly low: number | null;
            readonly logged: number | null;
            readonly filed: number | null;
            readonly rested: number | null;
          }>(sql`select
              (select ${threadRolloutCursor.restedAt} is not null from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadId}) as rested,
              (select ${threadConversation.through} from ${threadConversation} where ${threadConversation.threadId} = ${threadId}) as through,
              (select ${threadConversation.unreadable} from ${threadConversation} where ${threadConversation.threadId} = ${threadId}) as unreadable,
              coalesce((select 1 from ${threadBase} where ${threadBase.threadId} = ${threadId} limit 1),
                (select min(${threadEvent.position}) from ${threadEvent} where ${threadEvent.threadId} = ${threadId})) as low,
              nullif(${journalHead(sql`${threadId}`)}, 0) as logged,
              (select ${threadRolloutCursor.nextPosition} - 1 from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadId}) as filed`),
        ),
      ),
      ([row]) => ({
        rested: row?.rested === 1,
        through: row?.through ?? 0,
        unreadable: row?.unreadable === 1,
        low: row?.rested === 1 ? null : (row?.low ?? null),
        logged: row?.rested === 1 ? null : (row?.logged ?? null),
        filed: row?.filed ?? null,
      }),
    );

  const apply = Effect.fnUntraced(function* (threadId: string, from: number, to: number, rows: readonly IndexedEvent[]) {
    let applied = from;
    for (let at = 0; at < rows.length || applied < to; at += BATCH) {
      const batch = rows.slice(at, at + BATCH);
      const reached = at + BATCH >= rows.length ? to : batch[batch.length - 1]!.position;
      const moved = yield* units.write(filling, (unit) =>
        conversationCarried(
          db,
          unit,
          threadId,
          applied,
          reached,
          batch.map((row) => ({ position: row.position, payload: row.payload })),
        ),
      );
      if (!moved) return false;
      applied = reached;
    }
    return true;
  });

  const whole = (threadId: string, low: number | null, head: number): Effect.Effect<boolean> => {
    if (low === 1) return Effect.succeed(true);
    const upto = low === null ? head : low - 1;
    return journal.range(threadId, { head: upto, afterPosition: 0, limit: 1, kinds: [] }).pipe(
      Effect.map((read) => !read.missing && read.through >= upto),
      Effect.catchTag('ThreadStorageFailed', () => Effect.succeed(false)),
    );
  };

  const thread = Effect.fn('ConversationBackfill.thread')(function* (threadId: string) {
    yield* Effect.annotateCurrentSpan({ threadId });
    let last = { from: -1, head: -1 };
    while (true) {
      const standing = yield* standingOf(threadId);
      const from = standing.through;
      const head = standing.logged ?? standing.filed ?? 0;
      if (from <= last.from && head <= last.head) return;
      last = { from, head };
      if (from >= head) {
        if (!standing.unreadable) {
          if (yield* units.write(filling, (unit) => conversationSettled(db, unit, threadId))) return;
          continue;
        }
        if (!(yield* whole(threadId, standing.low, head))) return;
        yield* units.write(filling, (unit) => conversationCleared(db, unit, threadId));
        last = { from: -1, head: -1 };
        continue;
      }
      const read = yield* journal
        .range(threadId, { head, afterPosition: from, limit: standing.rested ? READ : PAGE, kinds: CONVERSATION_KINDS })
        .pipe(Effect.catchTag('ThreadStorageFailed', () => Effect.succeed({ rows: [], through: from, missing: true })));
      const reached = read.through;
      if (!(yield* apply(threadId, from, reached, read.rows))) return;
      if (!read.missing) continue;
      const low = standing.low;
      if (low !== null && reached < low - 1) {
        yield* units.write(filling, (unit) => conversationSkipped(db, unit, threadId, low - 1));
        continue;
      }
      yield* units.write(filling, (unit) => conversationUnreadable(db, unit, threadId, head));
      return;
    }
  });

  return {
    run: Effect.fn('ConversationBackfill.run')(function* () {
      yield* units.write(filling, (unit) =>
        unit.run(
          db.run(sql`insert into ${threadConversation} (thread_id) select ${threadRecord.id} from ${threadRecord}
            where not exists (select 1 from ${threadConversation} where ${threadConversation.threadId} = ${threadRecord.id})
              and not exists (select 1 from ${threadEvent} where ${threadEvent.threadId} = ${threadRecord.id})
              and not exists (select 1 from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadRecord.id} and ${threadRolloutCursor.nextPosition} > 1)`),
        ),
      );
      const behind = yield* units.read((unit) =>
        unit.run(
          db.all<{ readonly id: string }>(sql`select ${threadRecord.id} as id from ${threadRecord}
            left join ${threadConversation} on ${threadConversation.threadId} = ${threadRecord.id}
            where (${threadConversation.threadId} is null
              or ${threadConversation.through} < ${threadConversation.seen} or ${threadConversation.unreadable} = 1)
            order by ${threadRecord.createdAt} desc`),
        ),
      );
      for (const { id } of behind) yield* thread(id);
      return behind.length;
    }),
    thread,
  };
});
