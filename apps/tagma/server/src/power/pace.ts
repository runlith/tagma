import { Duration, Effect, Layer, PubSub, Queue, Result, Stream } from 'effect';
import type { PaceReport } from '@runlith/executions/protocol/pace';
import { Settings } from '../settings/contract/service/values.js';
import { type PaceLevel, DEFAULT_AGENT_PACE, type PaceState, type PaceHandover } from './contract/wire/power.js';
import { AgentPace, HostPace } from './contract/service/pace.js';
import { agentWork } from './keys.js';

const stateOf = (report: PaceReport): PaceHandover =>
  report._tag === 'Unavailable'
    ? { _tag: 'unavailable', reason: report.reason }
    : { _tag: 'applied', pace: report.pace, reached: report.reached, kept: report.kept, failed: report.failed };

const refusedState = (failure: { readonly reason: string }): PaceHandover => ({
  _tag: 'unavailable',
  reason: failure.reason,
});

export const PACE_RETRY_MS = 30_000;

export const agentPaceLayer: Layer.Layer<AgentPace, never, HostPace | Settings> = Layer.effect(
  AgentPace,
  Effect.gen(function* () {
    return yield* holdAgentPace(yield* HostPace, yield* Settings);
  }),
);

export const holdAgentPace = Effect.fnUntraced(function* (
  host: HostPace['Service'],
  settings: Settings['Service'],
  retryMs: number = PACE_RETRY_MS,
) {
  const published = yield* Effect.acquireRelease(PubSub.sliding<PaceState>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  const wanted = yield* Queue.sliding<void>(1);
  const read = yield* Effect.result(settings.value(agentWork));
  if (Result.isFailure(read)) {
    yield* Effect.logWarning("the agents' pace setting could not be read, so the default stands", { reason: read.failure._tag });
  }
  let last: PaceState = { pace: Result.isSuccess(read) ? read.success : DEFAULT_AGENT_PACE, state: { _tag: 'handing' } };
  const publish = (next: PaceState) =>
    Effect.andThen(
      Effect.sync(() => {
        last = next;
      }),
      PubSub.publish(published, next),
    );
  let desired = last.pace;
  let owed = false;
  const hand = Effect.fnUntraced(function* (pace: PaceLevel) {
    owed = false;
    yield* publish({ pace, state: { _tag: 'handing' } });
    const answered = yield* Effect.result(host.apply(pace));
    owed = answered._tag === 'Failure';
    yield* publish({ pace, state: answered._tag === 'Success' ? stateOf(answered.success) : refusedState(answered.failure) });
  });
  const settle = Effect.suspend(() => (last.pace === desired && last.state._tag === 'applied' ? Effect.void : hand(desired)));
  const want = (pace: PaceLevel) =>
    Effect.suspend(() => {
      desired = pace;
      return Queue.offer(wanted, undefined);
    });
  yield* PubSub.publish(published, last);
  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Queue.take(wanted), settle)));
  yield* Queue.offer(wanted, undefined);
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.andThen(
        Effect.sleep(Duration.millis(retryMs)),
        Effect.suspend(() => (owed ? Queue.offer(wanted, undefined) : Effect.void)),
      ),
    ),
  );
  const changes = yield* Effect.result(settings.changes(agentWork));
  if (changes._tag === 'Failure') {
    yield* Effect.logWarning("the agents' pace was handed once and will not follow the setting", { reason: changes.failure._tag });
  } else {
    yield* Effect.forkScoped(Stream.runForEach(changes.success, want));
  }
  return AgentPace.of({
    state: () => last,
    changes: Stream.fromPubSub(published),
  });
});
