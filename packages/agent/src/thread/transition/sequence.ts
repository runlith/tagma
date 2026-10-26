import { Context, Effect, Layer, Semaphore } from 'effect';
import { actDigest, type TransitionOutcome } from '../keyed';
import { ThreadTransitions } from '../ThreadPorts';
import type { ThreadBorderFailed, ThreadPortFailure } from '../ThreadBorder';
import { transitionNow, type TransitionDeps } from './kernel';
import type { TransitionPlan } from './port';

type RunSequence = { readonly lock: Semaphore.Semaphore; next: number | null };

export class ThreadRunSequences extends Context.Service<
  ThreadRunSequences,
  {
    sequenced<A, E>(
      runId: string,
      act: (seq: number) => Effect.Effect<TransitionOutcome<A>, E>,
    ): Effect.Effect<TransitionOutcome<A>, E | ThreadPortFailure>;
    forget(runId: string): void;
  }
>()('@runlith/agent/ThreadRunSequences') {}

export const threadRunSequencesLayer: Layer.Layer<ThreadRunSequences, never, ThreadTransitions> = Layer.effect(
  ThreadRunSequences,
  Effect.gen(function* () {
    const transitions = yield* ThreadTransitions;
    const runs = new Map<string, RunSequence>();
    const held = (runId: string): RunSequence => {
      const standing = runs.get(runId);
      if (standing) return standing;
      const made: RunSequence = { lock: Semaphore.makeUnsafe(1), next: null };
      runs.set(runId, made);
      return made;
    };
    return ThreadRunSequences.of({
      sequenced: (runId, act) => {
        const sequence = held(runId);
        return sequence.lock.withPermits(1)(
          Effect.gen(function* () {
            const seq = sequence.next ?? (yield* transitions.appliedSeq(runId)) + 1;
            const outcome = yield* act(seq).pipe(Effect.onError(() => Effect.sync(() => void (sequence.next = null))));
            sequence.next = 'committed' in outcome || 'replayed' in outcome ? seq + 1 : seq;
            return outcome;
          }),
        );
      },
      forget: (runId) => {
        runs.delete(runId);
      },
    });
  }),
);

export function runTransition<A, TWrite extends TTx, E = ThreadBorderFailed, TTx = unknown>(
  deps: TransitionDeps<TTx, TWrite>,
  sequences: Context.Service.Shape<typeof ThreadRunSequences>,
  run: { readonly id: string; readonly threadId: string },
  plan: TransitionPlan<A, TWrite, E>,
  request: unknown,
): Effect.Effect<TransitionOutcome<A>, E | ThreadPortFailure> {
  const digest = actDigest(request);
  return sequences.sequenced(run.id, (seq) => transitionNow(deps, run.threadId, plan, { evidence: { run: run.id, seq }, digest }));
}
