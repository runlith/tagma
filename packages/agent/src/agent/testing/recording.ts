import { Array as Arr, Cause, Deferred, Effect, Stream } from 'effect';
import type { Agent } from '../Agent';
import type { AgentEvent } from '../AgentEvent';
import type { AgentRuntimeGuidance } from '../contracts';
import type { AgentRunBroke } from '../AgentFailure';
import type { AgentRunner, AgentRunInput, AgentRunHandle } from '../AgentRunner';
import { RunStop } from '../RunStop';

export type RecordedRun = AgentRunHandle & {
  readonly recording: Recording<AgentEvent, AgentRunBroke>;
  readonly guidance: readonly AgentRuntimeGuidance[];
};

export type RecordedInput<TCtx> = Omit<AgentRunInput<TCtx>, 'stop'> & { readonly stop?: RunStop };

export const recordRun = Effect.fn(function* <TCtx>(runner: AgentRunner, agent: Agent<TCtx>, input: RecordedInput<NoInfer<TCtx>>) {
  const record = recording<AgentEvent, AgentRunBroke>();
  const guidance: AgentRuntimeGuidance[] = [];
  const handle = yield* runner.run(
    agent,
    { ...input, stop: input.stop ?? new RunStop() },
    {
      push: (event) =>
        Effect.suspend(() => {
          if (event.type !== 'runtime-guidance') return record.push(event);
          guidance.push(event.entry);
          return record.push({ type: 'data-runtime-guidance', id: event.entry.id, data: event.entry });
        }),
    },
  );
  yield* Effect.forkDetach(
    Effect.matchEffect(handle.output.steps, {
      onFailure: record.fail,
      onSuccess: () => record.close,
    }),
  );
  return { ...handle, recording: record, guidance } satisfies RecordedRun;
});

export type Recording<A, E = never> = {
  readonly push: (entry: A) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
  readonly fail: (failure: E) => Effect.Effect<void>;
  readonly entries: () => readonly A[];
  readonly stream: () => Stream.Stream<A, E>;
};

export function recording<A, E = never>(): Recording<A, E> {
  const delivered: A[] = [];
  let closed = false;
  let failed = false;
  let failure: E | null = null;
  let arrival = Deferred.makeUnsafe<void>();

  const notify = (): void => {
    const waiting = arrival;
    arrival = Deferred.makeUnsafe<void>();
    Deferred.doneUnsafe(waiting, Effect.void);
  };

  const read = (): Stream.Stream<A, E> =>
    Stream.fromPull(
      Effect.sync(() => {
        let index = 0;
        const pull: Effect.Effect<Arr.NonEmptyReadonlyArray<A>, E | Cause.Done> = Effect.suspend(() => {
          if (index < delivered.length) {
            const ready = delivered.slice(index);
            index = delivered.length;
            if (Arr.isReadonlyArrayNonEmpty(ready)) return Effect.succeed(ready);
          }
          if (closed) return failed && failure !== null ? Effect.fail(failure) : Cause.done();
          return Effect.flatMap(Deferred.await(arrival), () => pull);
        });
        return pull;
      }),
    );

  return {
    push: (entry) =>
      Effect.sync(() => {
        if (closed) return;
        delivered.push(entry);
        notify();
      }),
    close: Effect.sync(() => {
      if (closed) return;
      closed = true;
      notify();
    }),
    fail: (ending) =>
      Effect.sync(() => {
        if (closed) return;
        closed = true;
        failed = true;
        failure = ending;
        notify();
      }),
    entries: () => delivered,
    stream: read,
  };
}
