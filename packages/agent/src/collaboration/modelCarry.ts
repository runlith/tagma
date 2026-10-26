import { Cause, Effect } from 'effect';
import type { KeyedRequest, KeyedSpent } from '../thread/keyed';
import { ThreadStorageFailed } from '../thread/persisted';
import type { ThreadModelSelection } from '../thread/record';
import { RunAdmission } from '../thread/run/runAdmission';
import { ThreadModelRefused } from './model';
import { ThreadRunConflict, ThreadRunRefused, ThreadRuns, type ThreadRunsFailure, type ThreadStopReceipt } from './runs';
export type CarriedMove =
  | {
      readonly to: ThreadModelSelection;
      readonly resume?: string;
    }
  | KeyedSpent
  | null;
export type ModelCarryAsk<A extends CarriedMove, E> = {
  readonly threadId: string;
  readonly request: KeyedRequest;
  readonly move: (resume?: string) => Effect.Effect<A, E>;
  readonly running: (failure: E) => boolean;
  readonly stopped?: ThreadStopReceipt | null;
  readonly self?: boolean;
  readonly restoreOnFailure?: boolean;
};
export type ModelCarry<A> = {
  readonly moved: A;
  readonly runId: string | undefined;
};
const landed = (moved: CarriedMove) => (moved !== null && 'to' in moved ? moved : null);
const endedOrGoing = (failure: unknown): failure is ThreadRunRefused | ThreadRunConflict =>
  (failure instanceof ThreadRunRefused && failure.reason === 'not-interrupted') ||
  (failure instanceof ThreadRunConflict && failure.reason === 'running');
export const carryModelMove = Effect.fnUntraced(function* <A extends CarriedMove, E>(
  ask: ModelCarryAsk<A, E>,
): Effect.fn.Return<ModelCarry<A>, E | ThreadModelRefused | ThreadRunsFailure, ThreadRuns | RunAdmission> {
  const runs = yield* ThreadRuns;
  const admission = yield* RunAdmission;
  const { threadId, request, move } = ask;
  const stopped = ask.stopped ?? null;
  const going = Effect.map(runs.current(threadId), (run) => run?.runId);
  const restored = (failure: Cause.Cause<E | ThreadModelRefused | ThreadRunsFailure>, turn: string | undefined) =>
    ask.restoreOnFailure !== true || turn === undefined
      ? Effect.failCause(failure)
      : runs.continue(threadId, { request, expected: turn }).pipe(
          Effect.catchIf(endedOrGoing, () => Effect.void),
          Effect.matchEffect({
            onSuccess: () => Effect.failCause(failure),
            onFailure: (lost) =>
              Effect.fail(
                new ThreadStorageFailed({
                  call: 'model.restore',
                  cause: new Error(
                    `Thread ${threadId} did not move: ${Cause.pretty(failure)} Its turn ${turn}, stopped for the move, did not resume either; continuing the thread takes it up.`,
                    { cause: lost },
                  ),
                }),
              ),
          }),
        );
  const resumed = (carried: { readonly to: ThreadModelSelection; readonly resume: string }) =>
    runs.continue(threadId, { request, expected: carried.resume }).pipe(
      Effect.map((continued) => (continued.status === 'spent' ? undefined : continued.runId)),
      Effect.catchIf(
        (failure): failure is ThreadStorageFailed => failure instanceof ThreadStorageFailed,
        (failure) =>
          Effect.flatMap(going, (current) =>
            Effect.fail(
              new ThreadStorageFailed({
                call: 'model.resume',
                cause: new Error(
                  `Thread ${threadId} moved to ${carried.to.provider}/${carried.to.model}, ` +
                    (current === undefined
                      ? 'and resuming its stopped turn failed; continuing the thread takes it up'
                      : `and run ${current} goes on it, though resuming answered a failure`),
                  { cause: failure },
                ),
              }),
            ),
          ),
      ),
      Effect.catchIf(endedOrGoing, () => going),
    );
  return yield* Effect.uninterruptibleMask(
    Effect.fnUntraced(function* (interruptible) {
      let halted: string | undefined;
      const moved = yield* Effect.acquireUseRelease(
        Effect.sync(() => admission.hold([threadId])),
        () =>
          interruptible(move(stopped?.status === 'stopped' ? (stopped.runId ?? undefined) : undefined)).pipe(
            Effect.catchIf(
              ask.running,
              Effect.fnUntraced(function* (failure) {
                if (stopped !== null) return yield* Effect.fail(failure);
                const active = yield* runs.current(threadId);
                if (active === null) return yield* interruptible(move());
                if (ask.self === true) return yield* new ThreadModelRefused({ threadId, reason: 'self-move' });
                const stop = yield* interruptible(runs.stop(threadId, { request, expected: active.runId, by: 'model', at: 'step' }));
                if (stop.status === 'stopping') return yield* new ThreadModelRefused({ threadId, reason: 'step-unreached' });
                if (stop.status === 'stopped') halted = active.runId;
                return yield* move(halted);
              }),
            ),
          ),
        (lift) => Effect.sync(() => lift()),
      ).pipe(Effect.catchCause((failure) => restored(failure, halted)));
      const carried = landed(moved);
      if (carried?.resume === undefined) return { moved, runId: undefined };
      return { moved, runId: yield* resumed({ to: carried.to, resume: carried.resume }) };
    }),
  );
});
