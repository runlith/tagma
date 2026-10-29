import { Cause, Effect, Exit } from 'effect';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadEvictionVerdict } from '../contract/wire/eviction.js';
import type { RolloutContext } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';
import type { RolloutStaged } from './rolloutEntryForms.js';
import type { ThreadUses } from './uses.js';

const BUSY = { kind: 'busy' } as const;

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

  const restedNow = (threadId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (ctx.kinds.last === null || going.has(threadId)) return Effect.void;
      going.add(threadId);
      deferred.delete(threadId);
      return later(
        threadId,
        Effect.gen(function* () {
          const place = yield* placed(threadId);
          if (place === null) return;
          const staging = yield* forms.staged(threadId, place.path);
          if (staging === null) return;
          const outcome = yield* ctx
            .inJournal(
              threadId,
              uses.rest<Effect.Success<RolloutStaged['commit']> | typeof BUSY, Effect.Error<RolloutStaged['commit']>, never>(
                threadId,
                staging.commit,
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
            if (recalled.delete(threadId) && deferred.has(threadId)) runAppend(restedNow(threadId));
          }),
        ),
      );
    });

  return {
    resident,
    rested: (threadId: string): void => runAppend(restedNow(threadId)),
    released: (threadId: string): void => {
      if (going.has(threadId)) recalled.add(threadId);
      else if (deferred.has(threadId)) runAppend(restedNow(threadId));
    },
  };
};
