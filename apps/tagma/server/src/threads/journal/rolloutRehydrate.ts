import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { stored } from '../../platform/store/crossing.js';
import { recordFacts } from '../../thread-record/facts.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadScratch } from '../resources/scratch.js';
import type { ThreadGate } from '../list/store.js';
import { restStamps } from '../rest.js';
import { rolloutTransformed } from './rolloutGeneration.js';
import { openRollout, rolloutStateOf } from './rolloutForms.js';
import { rehydrateThreadRecords } from './replay.js';
import type { RolloutContext } from './rolloutContext.js';
import { unformableRefusal, type RolloutForms } from './rolloutForming.js';

export const rolloutRehydrating = (ctx: RolloutContext, forms: RolloutForms, scratch: ThreadScratch) => {
  const { graph, parts, machineStore, inJournal, locate } = ctx;
  const wake = Effect.fnUntraced(function* (threadId: string, path: string): Effect.fn.Return<void, HarnessFailure> {
    const standing = yield* rolloutStateOf(path);
    const file = standing === null ? {} : { bytes: standing.bytes, compressed: standing.form === 'compressed' };
    yield* Effect.gen(function* () {
      yield* forms.formedHere(threadId, path).pipe(
        Effect.andThen(openRollout(path, rolloutTransformed(Context.get(graph, MachineStore), threadId, path))),
        Effect.withSpan('ThreadRollout.rehydrate.open', { attributes: { threadId, ...file } }),
        Effect.andThen(
          rehydrateThreadRecords({ threadId, path, parts }, ctx.publication).pipe(
            machineStore,
            Effect.provideService(ThreadEntryKinds, ctx.kinds),
          ),
        ),
        Effect.catchTag(['RolloutUnreadable', 'RolloutSyncRefused'], (failure) =>
          Effect.fail(
            new GateRefusal(`rollout-${failure.reason}`, failure.message, [
              'read what this rollout disagrees about first; the file stands exactly as it did',
            ]),
          ),
        ),
        Effect.catchTag('RolloutUnformable', (failure) => Effect.fail(unformableRefusal(failure))),
      );
      yield* scratch.ensure(threadId);
    }).pipe(Effect.withSpan('ThreadRollout.rehydrate', { attributes: { threadId, ...file } }));
  });

  const rehydrate = Effect.fnUntraced(function* (threadId: string, read?: ThreadGate): Effect.fn.Return<void, HarnessFailure> {
    if (ctx.home === undefined) return;
    const store = Context.get(graph, MachineStore);
    const facet =
      read ??
      (yield* stored('rollout-rehydrate')(
        Effect.mapError(
          store.db
            .select({ projectId: recordFacts.projectId, evictedAt: restStamps.restedAt })
            .from(recordFacts)
            .innerJoin(restStamps, eq(restStamps.id, recordFacts.id))
            .where(eq(recordFacts.id, threadId))
            .get(),
          (error) => error,
        ),
      ));
    if (facet === undefined || facet.evictedAt === null || facet.projectId === null) return;
    const path = yield* stored('rollout-rehydrate')(locate(threadId));
    if (path === undefined) return;
    yield* inJournal(
      threadId,
      Effect.gen(function* () {
        const standing = yield* stored('rollout-rehydrate')(
          Effect.mapError(
            store.db.select({ evictedAt: restStamps.restedAt }).from(restStamps).where(eq(restStamps.id, threadId)).get(),
            (error) => error,
          ),
        );
        if (standing === undefined || standing.evictedAt === null) return;
        yield* wake(threadId, path);
      }),
    );
  });

  return { rehydrate, wake };
};
