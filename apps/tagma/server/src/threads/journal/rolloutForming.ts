import { and, eq, isNotNull } from 'drizzle-orm';
import { Effect, Result } from 'effect';
import { writes } from '../../platform/contract/service/writes.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ReentrantCall } from '@runlith/held/failures';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { threadRolloutForm } from '../store/journal.js';
import {
  eventless,
  formRollout,
  olderRollout,
  rolloutFormOf,
  RolloutUnformable,
  settledRollout,
  stagedRollout,
  type RolloutFormWrite,
  type RolloutStaged,
} from './rolloutEntryForms.js';
import type { RolloutUnreadable } from './rolloutFile.js';
import { openRollout, rolloutStateOf } from './rolloutForms.js';
import type { JournalEntry } from './rolloutContext.js';

const UNREFUSING = writes('ThreadRollout.unrefuse', [threadRolloutForm]);

export type RolloutFormFailure = RolloutUnformable | RolloutUnreadable | StoreFailure;

export const unformableRefusal = (failure: RolloutUnformable): GateRefusal =>
  new GateRefusal(
    'rollout-unformable',
    failure.message,
    failure.older === undefined
      ? ['repair_thread_rollout clears the refusal and forms the file again; the file stands exactly as it did']
      : [
          `open this thread once with Tagma ${failure.older.release}, which brings its journal to ${failure.older.step}; the file stands exactly as it did`,
        ],
  );

export type RolloutForms = Effect.Success<ReturnType<typeof makeRolloutForms>>;

export const makeRolloutForms = Effect.fnUntraced(function* ({ journal }: { readonly journal: JournalEntry }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const write: RolloutFormWrite = (operation, body) => units.write(operation, body);

  const formedHere = (threadId: string, path: string): Effect.Effect<void, RolloutFormFailure> =>
    Effect.flatMap(formRollout(db, write, threadId, path, kinds), (outcome) =>
      outcome.kind === 'refused' ? Effect.fail(outcome.refusal) : Effect.void,
    );

  const checked = Effect.fnUntraced(function* (threadId: string, path: string) {
    const standing = yield* rolloutFormOf(db, threadId);
    if (standing?.refusal != null) return yield* new RolloutUnformable({ threadId, path, reason: standing.refusal });
    const step = standing?.step ?? null;
    if (kinds.base !== null && kinds.below(step)) return yield* olderRollout(threadId, path, step, kinds.base);
    return standing;
  });

  const within = <A, E>(threadId: string, work: Effect.Effect<A, E>) =>
    Effect.flatMap(Effect.result(journal(threadId, work)), (entered) => {
      if (Result.isSuccess(entered)) return Effect.succeed(entered.success);
      const failure = entered.failure;
      return failure instanceof ThreadStorageFailed && failure.cause instanceof ReentrantCall ? work : Effect.fail(failure);
    });

  return {
    formedHere,
    reformedHere: (threadId: string, path: string): Effect.Effect<void, RolloutFormFailure> =>
      units
        .write(UNREFUSING, (unit) =>
          unit.run(db.delete(threadRolloutForm).where(and(eq(threadRolloutForm.threadId, threadId), isNotNull(threadRolloutForm.refusal)))),
        )
        .pipe(Effect.andThen(formedHere(threadId, path))),
    lags: (threadId: string): Effect.Effect<boolean, StoreFailure> =>
      kinds.last === null
        ? Effect.succeed(false)
        : Effect.map(
            rolloutFormOf(db, threadId),
            (standing) =>
              standing === undefined || (standing.refusal === null && (standing.publishing !== null || kinds.lags(standing.step))),
          ),
    eventlessLag: (threadId: string): Effect.Effect<boolean, StoreFailure> =>
      Effect.map(
        rolloutFormOf(db, threadId),
        (standing) =>
          standing !== undefined &&
          standing.refusal === null &&
          standing.publishing === null &&
          standing.step !== null &&
          kinds.lags(standing.step) &&
          eventless(kinds.after(standing.step)),
      ),
    checked: (threadId: string, path: string): Effect.Effect<void, RolloutUnformable | StoreFailure> =>
      Effect.asVoid(checked(threadId, path)),
    readable: Effect.fnUntraced(function* (threadId: string, path: string) {
      const standing = yield* checked(threadId, path);
      const state = yield* rolloutStateOf(path);
      if (standing?.publishing == null && state?.form !== 'compressed') return;
      yield* within(threadId, settledRollout(db, write, threadId, path, kinds).pipe(Effect.andThen(openRollout(path))));
    }),
    staged: (threadId: string, path: string): Effect.Effect<RolloutStaged | null, RolloutFormFailure> =>
      Effect.flatMap(stagedRollout(db, write, threadId, path, kinds, true), (outcome) =>
        outcome.kind === 'refused' ? Effect.fail(outcome.refusal) : Effect.succeed(outcome.kind === 'staged' ? outcome : null),
      ),
    formedOpen: Effect.fnUntraced(function* (threadId: string, path: string) {
      const standing = yield* rolloutFormOf(db, threadId);
      const state = yield* rolloutStateOf(path);
      if (standing !== undefined && standing.publishing === null && state?.form !== 'compressed') {
        yield* checked(threadId, path);
        return;
      }
      yield* within(threadId, formedHere(threadId, path).pipe(Effect.andThen(openRollout(path))));
    }),
  };
});
