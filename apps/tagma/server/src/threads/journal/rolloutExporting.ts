import { Cause, Context, Effect } from 'effect';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { journalProjectOf, threadEvent, threadRolloutCursor, threadRolloutRefusal } from '../store/journal.js';
import { RolloutWriterFailed } from './rolloutWriter.js';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MachineStore } from '../../platform/contract/service/store.js';
import { stored } from '../../platform/store/crossing.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import { exportThreadRollout } from './export.js';
import { filed, unfiled } from './base.js';
import { rolloutStateOf } from './rolloutForms.js';
import type { RolloutContext } from './rolloutContext.js';

export const rolloutExporting = (ctx: RolloutContext) => {
  const { floor, parts, machineStore, inJournal, pathOf, locate, graph } = ctx;

  const journaled = Effect.fnUntraced(function* (threadId: string) {
    const { db } = Context.get(graph, MachineStore);
    const prior = yield* db
      .select({
        recorded: sql<number>`exists(select 1 from ${threadRolloutCursor} where ${threadRolloutCursor.threadId} = ${threadId})
          or exists(select 1 from ${threadRolloutRefusal} where ${threadRolloutRefusal.threadId} = ${threadId})`,
        logged: sql<number>`exists(select 1 from ${threadEvent} where ${threadEvent.threadId} = ${threadId})`,
      })
      .from(recordFacts)
      .where(eq(recordFacts.id, threadId))
      .get();
    return { recorded: prior === undefined || prior.recorded !== 0, logged: prior?.logged === 1 };
  });

  const missing = Effect.fnUntraced(function* (threadId: string, path: string) {
    if ((yield* rolloutStateOf(path)) !== null) return false;
    yield* floor.checkBirth(threadId, path);
    if ((yield* journaled(threadId)).recorded) {
      return yield* new RolloutWriterFailed({
        reason: 'io',
        threadId,
        message: `thread ${threadId} records an earlier journal or has no row; its missing rollout cannot be exported`,
      });
    }
    return true;
  });

  const exportedWhole = Effect.fnUntraced(function* (threadId: string, path: string, prefix: boolean) {
    yield* ctx.retention.using(
      threadId,
      Effect.gen(function* () {
        floor.forget(threadId);
        yield* machineStore(exportThreadRollout({ threadId, path, parts, prefix }, ctx.publication, ctx.replacement)).pipe(
          Effect.provideService(ThreadEntryKinds, ctx.kinds),
        );
        floor.forget(threadId);
        yield* filed(Context.get(graph, MachineStore), threadId);
      }),
    );
  });

  const written = (threadId: string, path: string) => exportedWhole(threadId, path, false);

  const whole = (threadId: string, path: string) => exportedWhole(threadId, path, true);

  const exported = Effect.fnUntraced(function* (threadId: string, path: string) {
    yield* Effect.promise(() => mkdir(dirname(path), { recursive: true }));
    if (!(yield* missing(threadId, path))) return;
    yield* written(threadId, path);
  });

  const pathFor = locate;

  const ensure = Effect.fnUntraced(function* (threadId: string) {
    const path = yield* pathFor(threadId);
    if (path === undefined || (yield* rolloutStateOf(path)) !== null) return;
    yield* inJournal(threadId, exported(threadId, path));
  });

  const behind = Effect.fnUntraced(function* (threadId: string) {
    const path = yield* pathFor(threadId);
    if (path === undefined || !(yield* missing(threadId, path))) return Effect.void;
    return inJournal(threadId, exported(threadId, path));
  });

  const owed = Effect.fnUntraced(function* (threadId: string) {
    if (ctx.replacement.pending(threadId)) {
      const path = yield* pathFor(threadId);
      if (path === undefined)
        return yield* new ThreadStorageFailed({
          call: 'source.recover',
          cause: new Error(`The journal place of ${threadId} is unavailable.`),
        });
      yield* ctx.replacement
        .settle(threadId, path)
        .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'source.recover', cause })));
      floor.forget(threadId);
    }
    if (!floor.unopened(threadId)) return;
    const path = yield* pathFor(threadId);
    if (path === undefined) return;
    if (yield* unfiled(Context.get(graph, MachineStore).db, threadId)) return yield* written(threadId, path);
    if ((yield* rolloutStateOf(path)) !== null) return;
    const standing = yield* journaled(threadId);
    if (standing.recorded || !standing.logged) return;
    yield* exported(threadId, path);
  });

  const exportStanding = Effect.fnUntraced(function* (): Effect.fn.Return<number, HarnessFailure> {
    if (ctx.home === undefined) return 0;
    const store = Context.get(graph, MachineStore);
    const rows = yield* stored('rollout-export')(
      Effect.mapError(
        store.db
          .select({ threadId: recordFacts.id, projectId: journalProjectOf(recordFacts.id, recordFacts.projectId) })
          .from(recordFacts)
          .where(isNotNull(recordFacts.projectId)),
        (error) => error,
      ),
    );
    let written = 0;
    for (const row of rows) {
      if (row.projectId === null) continue;
      const path = pathOf(row.projectId, row.threadId);
      if (path === undefined || (yield* rolloutStateOf(path)) !== null) continue;
      yield* inJournal(row.threadId, exported(row.threadId, path)).pipe(
        Effect.map(() => {
          written += 1;
        }),
        Effect.catchCause((cause) =>
          Effect.sync(() => console.error(`[tagma] rollout export failed for ${row.threadId}`, Cause.squash(cause))),
        ),
      );
    }
    return written;
  });

  const rewrite = Effect.fnUntraced(function* (threadId: string) {
    const path = yield* pathFor(threadId);
    if (path === undefined) return;
    const owing = Effect.flatMap(unfiled(Context.get(graph, MachineStore).db, threadId), (owes) =>
      owes ? written(threadId, path) : Effect.void,
    );
    yield* inJournal(threadId, owing).pipe(
      Effect.catchTag(['RolloutUnreadable', 'RolloutSyncRefused'], (failure) =>
        Effect.fail(
          new GateRefusal(
            `rollout-${failure.reason}`,
            `Branch ${threadId} reads its whole prefix from its own rows, but its rollout was not rewritten with that prefix: ${failure.message}`,
            [
              'read what this rollout disagrees about first; until it is rewritten, a restore from rollouts alone brings this branch back without its prefix',
            ],
          ),
        ),
      ),
    );
  });

  return { ensure, behind, owed, exportStanding, written, whole, rewrite };
};
