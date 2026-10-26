import { Effect, FiberSet, Layer, PubSub, Stream } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import type { AwakeState, SleepAssertionState } from './contract/wire/power.js';
import { AwakePolicy } from './contract/service/awake.js';
import { keepAwake } from './keys.js';
import { SleepAssertion, type SleepFacility } from './sleepAssertion.js';

const makeAwake = Effect.fnUntraced(function* (facility: SleepFacility) {
  const settings = yield* Settings;
  const fibers = yield* FiberSet.make<void, never>();
  const fork = yield* FiberSet.runtime(fibers)();
  const assertion = new SleepAssertion(facility, (work) => {
    fork(work);
  });
  const published = yield* Effect.acquireRelease(PubSub.sliding<AwakeState>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  const limit = facility._tag === 'helper' ? facility.limit : null;
  let mode = yield* Effect.orDie(settings.value(keepAwake));
  let running = 0;
  const state = (): AwakeState => ({ mode, state: assertion.state, limit });
  let last = state();

  const announce = () => {
    const standing = state();
    if (standing.mode === last.mode && same(standing.state, last.state)) return;
    last = standing;
    published.pubsub.slide();
    PubSub.publishUnsafe(published, standing);
  };
  const decide = () => {
    const wanted = mode === 'always' || (mode === 'while-working' && running > 0);
    if (wanted) assertion.acquire();
    else assertion.release();
    announce();
  };
  assertion.onChange(announce);

  yield* PubSub.publish(published, state());
  const modes = yield* Effect.orDie(settings.changes(keepAwake));
  yield* FiberSet.run(
    fibers,
    Stream.runForEach(modes, (next) =>
      Effect.sync(() => {
        if (next === mode) return;
        mode = next;
        decide();
      }),
    ),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => assertion.release()));
  return AwakePolicy.of({
    state,
    changes: Stream.fromPubSub(published),
    working: (runs) => {
      running = runs;
      decide();
    },
  });
});

export const awakePolicyLayer = (facility: SleepFacility) => Layer.effect(AwakePolicy, makeAwake(facility));

function same(one: SleepAssertionState, other: SleepAssertionState): boolean {
  if (one._tag !== other._tag) return false;
  return reasonOf(one) === reasonOf(other);
}

function reasonOf(state: SleepAssertionState): string | null {
  return state._tag === 'failed' || state._tag === 'unavailable' ? state.reason : null;
}
