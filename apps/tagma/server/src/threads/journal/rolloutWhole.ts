import { Cause, Deferred, Effect, Exit } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadEvictionVerdict } from '../contract/wire/eviction.js';
import type { RolloutContext } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';
import type { RolloutStaged } from './rolloutEntryForms.js';
import type { ThreadUses } from './uses.js';

const BUSY = { kind: 'busy' } as const;

type Committed = ReturnType<RolloutStaged['commit']>;

const later = (threadId: string, work: Effect.Effect<void, unknown>): Effect.Effect<void> =>
  Effect.flatMap(Effect.exit(work), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.void
      : Effect.logWarning(`the journal of ${threadId} is formed on a later visit`, { reason: Cause.squash(exit.cause) }),
  );

export const rolloutWhole = (
  ctx: RolloutContext,
  forms: RolloutForms,
  rest: (threadId: string) => Effect.Effect<ThreadEvictionVerdict, HarnessFailure>,
  wake: (threadId: string, path: string) => Effect.Effect<void, HarnessFailure>,
  runAppend: (effect: Effect.Effect<void>) => void,
  uses: ThreadUses,
) => {
  const going = new Set<string>();
  const deferred = new Set<string>();
  const recalled = new Set<string>();
  const queued = new Set<string>();
  const passes = new Map<string, Deferred.Deferred<void>>();
  let draining = false;

  const placed = Effect.fnUntraced(function* (threadId: string) {
    if (ctx.home === undefined || !(yield* forms.lags(threadId))) return null;
    const path = yield* ctx.locate(threadId);
    return path === undefined ? null : { path };
  });

  const resident = (threadId: string): Effect.Effect<void> =>
    ctx.kinds.last === null
      ? Effect.void
      : later(
          threadId,
          Effect.gen(function* () {
            const place = yield* placed(threadId);
            if (place === null) return;
            yield* ctx.inJournal(
              threadId,
              uses.rest(
                threadId,
                Effect.gen(function* () {
                  if (!(yield* forms.lags(threadId))) return;
                  yield* ctx.projection.run({ threadId, path: place.path });
                  if (yield* forms.eventlessLag(threadId)) return yield* forms.formedHere(threadId, place.path);
                  if ((yield* rest(threadId)).outcome !== 'evicted') return;
                  yield* wake(threadId, place.path);
                }),
                undefined,
              ),
            );
          }).pipe(Effect.withSpan('ThreadRollout.formWhole', { attributes: { threadId } })),
        );

  const settled = (threadId: string): void => {
    const pass = passes.get(threadId);
    passes.delete(threadId);
    if (pass !== undefined) Deferred.doneUnsafe(pass, Exit.void);
  };

  const next = Effect.sync(() => {
    const [threadId] = queued;
    if (threadId === undefined) {
      draining = false;
      return null;
    }
    queued.delete(threadId);
    return threadId;
  });

  const drain: Effect.Effect<void> = Effect.flatMap(next, (threadId) =>
    threadId === null ? Effect.void : Effect.andThen(restedNow(threadId), drain),
  );

  const queue = (threadId: string): void => {
    queued.add(threadId);
    if (draining) return;
    draining = true;
    runAppend(
      Effect.onInterrupt(drain, () =>
        Effect.sync(() => {
          draining = false;
        }),
      ),
    );
  };

  const requested = (threadId: string): void => {
    if (!passes.has(threadId)) passes.set(threadId, Deferred.makeUnsafe<void>());
    if (!going.has(threadId)) queue(threadId);
  };

  const restedNow = (threadId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (ctx.kinds.last === null) return Effect.sync(() => settled(threadId));
      going.add(threadId);
      deferred.delete(threadId);
      return later(
        threadId,
        Effect.gen(function* () {
          const place = yield* placed(threadId);
          if (place === null) return;
          const staging = yield* forms.staged(threadId, place.path);
          if (staging === null) return;
          if (staging.transcript !== null)
            yield* ctx.parts.native.folds.transcribe(staging.transcript.files, staging.transcript.key).pipe(
              Effect.provideService(ThreadEntryKinds, ctx.kinds),
              Effect.tapError(() => staging.discard),
            );
          const outcome = yield* ctx
            .inJournal(
              threadId,
              uses.rest<Effect.Success<Committed> | typeof BUSY, Effect.Error<Committed>, never>(
                threadId,
                staging.commit(staging.transcript !== null),
                BUSY,
              ),
            )
            .pipe(Effect.tapError(() => staging.discard));
          if (outcome.kind === 'refused') return yield* outcome.refusal;
          if (outcome.kind === 'formed') return;
          deferred.add(threadId);
          if (outcome.kind === 'busy') yield* staging.discard;
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            going.delete(threadId);
            if (recalled.delete(threadId) && deferred.has(threadId)) queue(threadId);
            else settled(threadId);
          }),
        ),
      );
    });

  return {
    resident,
    rested: requested,
    restedFormed: (threadId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const pass = passes.get(threadId);
        return pass === undefined ? Effect.void : Deferred.await(pass);
      }),
    released: (threadId: string): void => {
      if (going.has(threadId)) recalled.add(threadId);
      else if (deferred.has(threadId)) requested(threadId);
    },
  };
};
