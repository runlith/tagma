import { Clock, Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { eq, sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { publishedSourceRows, threadBase, threadEvent, threadRolloutCursor, threadRolloutForm } from '../store/journal.js';
import type { SourcePublication } from './sourceFiles.js';
import { restStamps, setRested } from '../rest.js';
import type { NativeFolds, RolloutParts } from './rolloutMeta.js';
import { fileSize } from './rolloutFile.js';
import type { ThreadEvictionVerdict, ThreadKeptReason } from '../contract/wire/eviction.js';
import { rolloutFiles } from './rolloutForms.js';
import { scanForRest } from './restScan.js';
import { sourceFactFingerprint } from './export.js';
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

type EvictionInput = {
  readonly threadId: string;
  readonly path: string | undefined;
  readonly parts: RolloutParts;
  readonly returning?: boolean;
  readonly whole?: boolean;
};

export const evictThreadProjection = Effect.fnUntraced(function* (input: EvictionInput, publication: SourcePublication) {
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
  const folds = input.parts.native.folds;
  const baseline = yield* folds.revision(input.threadId);
  const layers =
    input.whole === true
      ? yield* db.select({ sourceId: threadBase.sourceId }).from(threadBase).where(eq(threadBase.threadId, input.threadId))
      : [];
  const sources = [...new Set([input.threadId, ...layers.map((layer) => layer.sourceId)])];
  const revisions = yield* Effect.forEach(sources, (threadId) => folds.revision(threadId));
  if (baseline === null || revisions[0] !== baseline || revisions.some((revision) => revision === null)) return kept('records-missing');
  const rollout = yield* scanForRest(path).pipe(
    Effect.catchTag('WorkerUnavailable', (cause) => Effect.fail(new ThreadStorageFailed({ call: 'rollout.evict.scan', cause }))),
  );
  if (rollout === null) return kept('unreadable');
  if (rollout.torn) return kept('torn');
  if (rollout.unreadable) return kept('records-unreadable');
  const cursor = yield* db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, input.threadId)).get();
  if (cursor === undefined || cursor.nextByteOffset !== rollout.bytes) return kept('cursor-behind');
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

  const form = yield* db
    .select({ step: threadRolloutForm.step })
    .from(threadRolloutForm)
    .where(eq(threadRolloutForm.threadId, input.threadId))
    .get();
  const source = yield* publication
    .stage({ canonical: path, candidate: { kind: 'current' }, form: form?.step ?? null, origin: 'offload' })
    .pipe(
      Effect.catchTag('RolloutUnreadable', () => Effect.succeed(null)),
      Effect.catchTag('WorkerUnavailable', (cause) => Effect.fail(new ThreadStorageFailed({ call: 'rollout.evict.source', cause }))),
    );
  if (source === null) return kept('unreadable');
  const facts = yield* sourceFactFingerprint({ threadId: input.threadId, parts: input.parts, prefix: input.whole === true }).pipe(
    Effect.catchTag('RolloutSyncRefused', () => Effect.succeed(null)),
  );
  if (facts === null || facts !== source.factFingerprint) {
    yield* publication
      .discard(input.threadId, path, source)
      .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rollout.evict.source', cause })));
    return kept(facts === null ? 'records-unreadable' : 'records-missing');
  }
  if (source.bytes !== rollout.bytes || source.position + 1 !== cursor.nextPosition) {
    yield* publication
      .discard(input.threadId, path, source)
      .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rollout.evict.source', cause })));
    return kept('records-missing');
  }
  const at = new Date(yield* Clock.currentTimeMillis);
  const [filed, freed] = yield* store.freeing(
    Effect.gen(function* () {
      const filed = yield* store.transaction(
        writes('thread.evict', [threadEvent, threadRolloutCursor, publishedSourceRows, threadBase], folds.writes),
        (unit) =>
          Effect.gen(function* () {
            for (const [index, threadId] of sources.entries()) {
              if ((yield* folds.revision(threadId, unit)) !== revisions[index]) return false;
            }
            const current = yield* unit.run(
              db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, input.threadId)).get(),
            );
            const formed = yield* unit.run(
              db
                .select({ step: threadRolloutForm.step, publishing: threadRolloutForm.publishing })
                .from(threadRolloutForm)
                .where(eq(threadRolloutForm.threadId, input.threadId))
                .get(),
            );
            if (
              current === undefined ||
              current.restedAt !== null ||
              current.nextByteOffset !== cursor.nextByteOffset ||
              current.nextPosition !== cursor.nextPosition ||
              current.generation !== cursor.generation ||
              (formed?.step ?? null) !== source.form ||
              formed?.publishing != null
            )
              return false;
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
            yield* publication.publishIn(db, unit, input.threadId, path, source);
            yield* setRested(db, unit, input.threadId, at);
            return true;
          }),
      );
      if (filed) yield* dropJournal(input.threadId, folds, input.returning !== true);
      return filed;
    }),
  );
  if (!filed) {
    yield* publication
      .discard(input.threadId, path, source)
      .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rollout.evict.source', cause })));
    return kept('records-missing');
  }
  return { outcome: 'evicted', freedPages: freed } satisfies ThreadEvictionVerdict;
});
