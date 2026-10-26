import { Clock, Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadBase, threadEvent, threadRolloutCursor } from '../store/journal.js';
import { restStamps, setRested } from '../rest.js';
import type { NativeFolds, RolloutParts } from './rolloutMeta.js';
import { fileSize } from './rolloutFile.js';
import type { ThreadEvictionVerdict, ThreadKeptReason } from '../contract/wire/eviction.js';
import { rolloutFiles } from './rolloutForms.js';
import { scanForRest } from './restScan.js';
import { based, emptied, referencedThrough, remnant } from './base.js';

const DROP_ROWS = 50;
const PORTION_MS = 25;

export const dropJournal = Effect.fn('ThreadRollout.rest.drop')(function* (threadId: string, folds: NativeFolds, yielding: boolean) {
  yield* Effect.annotateCurrentSpan({ threadId });
  const store = yield* MachineStore;
  const { db } = store;
  const kept = yield* referencedThrough(db, threadId);
  const step = Effect.gen(function* () {
    const events = yield* db
      .delete(threadEvent)
      .where(
        sql`(${threadEvent.threadId}, ${threadEvent.position}) in (select ${threadEvent.threadId}, ${threadEvent.position} from ${threadEvent}
          where ${threadEvent.threadId} = ${threadId} and ${threadEvent.position} > ${kept ?? 0} order by ${threadEvent.position} limit ${DROP_ROWS})`,
      )
      .returning({ position: threadEvent.position });
    return events.length + (yield* folds.drop(threadId, DROP_ROWS, kept !== null));
  });
  while (true) {
    const portion = yield* store.transaction(writes('thread.rest.drop', [threadEvent], folds.writes), () =>
      Effect.gen(function* () {
        const started = performance.now();
        do {
          if ((yield* step) === 0) return { done: true, heldMs: performance.now() - started };
        } while (performance.now() - started < PORTION_MS);
        return { done: false, heldMs: performance.now() - started };
      }),
    );
    if (portion.done) return;
    if (yielding) yield* Effect.sleep(Math.max(PORTION_MS, portion.heldMs));
  }
});

export const evictThreadProjection = Effect.fnUntraced(function* (input: {
  readonly threadId: string;
  readonly path: string | undefined;
  readonly parts: RolloutParts;
  readonly returning?: boolean;
  readonly whole?: boolean;
}) {
  const store = yield* MachineStore;
  const { db } = store;
  const kept = (reason: ThreadKeptReason): ThreadEvictionVerdict => ({ outcome: 'kept', reason });
  const facet = yield* db.select({ evictedAt: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, input.threadId)).get();
  if (facet === undefined) return kept('no-facet');
  if (facet.evictedAt !== null) {
    if ((yield* referencedThrough(db, input.threadId)) !== null || !(yield* remnant(db, input.threadId))) return kept('evicted');
    const [, freed] = yield* store.freeing(dropJournal(input.threadId, input.parts.native.folds, input.returning !== true));
    return { outcome: 'evicted', freedPages: freed } satisfies ThreadEvictionVerdict;
  }
  if (input.whole !== true && (yield* based(db, input.threadId))) return kept('based');
  if ((yield* referencedThrough(db, input.threadId)) !== null) {
    if (input.returning !== true) return kept('referenced');
    if (!(yield* input.parts.native.folds.projected(input.threadId))) return kept('cursor-behind');
  }
  const path = input.path;
  if (path === undefined || (yield* Effect.promise(() => fileSize(path))) === null) return kept('no-file');
  const rollout = yield* scanForRest(path).pipe(
    Effect.catchTag('WorkerUnavailable', (cause) => Effect.fail(new ThreadStorageFailed({ call: 'rollout.evict.scan', cause }))),
  );
  if (rollout === null) return kept('unreadable');
  if (rollout.torn) return kept('torn');
  if (rollout.unreadable) return kept('records-unreadable');
  const cursor = yield* db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, input.threadId)).get();
  if (cursor === undefined || cursor.nextByteOffset !== rollout.bytes) return kept('cursor-behind');
  const folds = input.parts.native.folds;
  const held = yield* folds.heldKeys(input.threadId);
  const checkpoints = new Set(rollout.checkpoints);
  const pruned = new Set(rollout.pruned);
  if (held.checkpoints.some((id) => !checkpoints.has(id))) return kept('records-missing');
  if (held.pruned.some((id) => !pruned.has(id))) return kept('records-missing');
  if (input.returning !== true) {
    const transcribed = yield* folds.transcribe(rolloutFiles(path), { bytes: cursor.nextByteOffset, position: cursor.nextPosition }).pipe(
      Effect.as(true),
      Effect.catchTag('RolloutUnreadable', () => Effect.succeed(false)),
      Effect.catchTag('WorkerUnavailable', (cause) => Effect.fail(new ThreadStorageFailed({ call: 'rollout.evict.transcribe', cause }))),
    );
    if (!transcribed) return kept('unreadable');
  }

  const at = new Date(yield* Clock.currentTimeMillis);
  const [filed, freed] = yield* store.freeing(
    Effect.gen(function* () {
      const filed = yield* store.transaction(writes('thread.evict', [threadEvent, threadRolloutCursor, threadBase], folds.writes), (unit) =>
        Effect.gen(function* () {
          const logged = yield* unit.run(
            db
              .select({ head: sql<number>`coalesce(max(${threadEvent.position}), 0)` })
              .from(threadEvent)
              .where(eq(threadEvent.threadId, input.threadId))
              .get(),
          );
          if ((logged?.head ?? 0) >= cursor.nextPosition) return false;
          if (input.whole === true) yield* emptied(db, unit, input.threadId);
          yield* folds.release(input.threadId);
          yield* setRested(db, unit, input.threadId, at);
          return true;
        }),
      );
      if (filed) yield* dropJournal(input.threadId, folds, input.returning !== true);
      return filed;
    }),
  );
  if (!filed) return kept('records-missing');
  return { outcome: 'evicted', freedPages: freed } satisfies ThreadEvictionVerdict;
});
