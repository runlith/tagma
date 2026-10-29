import { Cause, Effect, Exit } from 'effect';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadEvictionVerdict } from '../contract/wire/eviction.js';
import type { RolloutContext } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';
import type { ThreadUses } from './uses.js';

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
      return later(
        threadId,
        Effect.gen(function* () {
          const place = yield* placed(threadId);
          if (place !== null) yield* ctx.inJournal(threadId, uses.rest(threadId, forms.formedHere(threadId, place.path), undefined));
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => going.delete(threadId))));
    });

  return { resident, rested: (threadId: string): void => runAppend(restedNow(threadId)) };
};
