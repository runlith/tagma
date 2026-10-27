import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { Cause, Context, Effect, Exit } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { stored } from '../../platform/store/crossing.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadRolloutCursor, threadRolloutForm } from '../store/journal.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadEvictionVerdict } from '../contract/wire/eviction.js';
import type { RolloutContext } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';
import type { ThreadUses } from './uses.js';
import type { Background } from '../../platform/contract/service/background.js';

const FORMING_REASON = 'A new release stores thread journals in a new form; each thread is brought to it once.';

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
  background: Background['Service'],
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

  const lagging = Effect.fn('ThreadRollout.formLagging')(function* () {
    const last = ctx.kinds.last;
    if (last === null) return 0;
    const { db } = Context.get(ctx.graph, MachineStore);
    const rows = yield* stored('journal-forming')(
      db
        .select({ threadId: threadRecord.id, restedAt: threadRolloutCursor.restedAt })
        .from(threadRecord)
        .leftJoin(threadRolloutForm, eq(threadRolloutForm.threadId, threadRecord.id))
        .leftJoin(threadRolloutCursor, eq(threadRolloutCursor.threadId, threadRecord.id))
        .where(
          and(
            isNull(threadRolloutForm.refusal),
            or(isNull(threadRolloutForm.step), lt(threadRolloutForm.step, last), isNotNull(threadRolloutForm.publishing)),
          ),
        ),
    );
    if (rows.length === 0) return 0;
    yield* background.run({ title: 'Updating thread journals', reason: FORMING_REASON, total: rows.length }, (progress) =>
      Effect.forEach(
        rows,
        ({ threadId, restedAt }) => Effect.andThen(restedAt === null ? resident(threadId) : restedNow(threadId), progress.advance()),
        { discard: true },
      ),
    );
    return rows.length;
  });

  return { resident, rested: (threadId: string): void => runAppend(restedNow(threadId)), lagging };
};
