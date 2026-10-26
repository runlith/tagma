import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Queue, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { PaceReport } from '@runlith/executions/protocol/pace';
import { Settings } from '../settings/contract/service/values.js';
import type { PaceLevel } from './contract/wire/power.js';
import { holdAgentPace } from './pace.js';

const settings = Effect.fnUntraced(function* (initial: PaceLevel) {
  const changes = yield* Queue.unbounded<PaceLevel>();
  const unused = () => Effect.die('pace reads only its value and changes');
  return {
    changes,
    service: Settings.of({
      value: (key) => Effect.succeed(initial as typeof key.fallback),
      changes: (key) => Effect.succeed(Stream.map(Stream.fromQueue(changes), (value) => value as typeof key.fallback)),
      read: unused,
      chain: unused,
      live: unused,
      held: unused,
      write: unused,
      amend: unused,
    }),
  };
});

const applied = (pace: PaceLevel): PaceReport => ({ _tag: 'Applied', pace, reached: 3, kept: 0, failed: 0 });

it.effect('pace hands over the standing setting and every change, keeping slow and new readers on the latest answer', () =>
  Effect.gen(function* () {
    const source = yield* settings('low');
    const applying = yield* Queue.unbounded<PaceLevel>();
    const answer = yield* Deferred.make<void>();
    const pace = yield* holdAgentPace(
      {
        apply: (level) => Queue.offer(applying, level).pipe(Effect.andThen(Deferred.await(answer)), Effect.as(applied(level))),
      },
      source.service,
    );
    expect(yield* Queue.take(applying)).toBe('low');
    const slow = yield* Stream.toPull(pace.changes);
    expect(yield* slow).toEqual([{ pace: 'low', state: { _tag: 'handing' } }]);
    yield* Deferred.succeed(answer, undefined);
    yield* Stream.runHead(Stream.filter(pace.changes, (state) => state.state._tag === 'applied'));
    yield* Queue.offer(source.changes, 'lowest');
    expect(yield* Queue.take(applying)).toBe('lowest');
    yield* Stream.runHead(Stream.filter(pace.changes, (state) => state.pace === 'lowest' && state.state._tag === 'applied'));
    expect(pace.state()).toEqual({ pace: 'lowest', state: { _tag: 'applied', pace: 'lowest', reached: 3, kept: 0, failed: 0 } });
    expect(yield* slow).toEqual([pace.state()]);
    expect(yield* Stream.runCollect(Stream.take(pace.changes, 1))).toEqual([pace.state()]);
  }),
);

it.effect('a refused pace remains unavailable until the next retry applies the same setting', () =>
  Effect.gen(function* () {
    const source = yield* settings('lowest');
    let refused = true;
    const pace = yield* holdAgentPace(
      {
        apply: (level) =>
          Effect.suspend(() => {
            if (!refused) return Effect.succeed(applied(level));
            refused = false;
            return Effect.fail({ reason: 'the host is not the custodian' });
          }),
      },
      source.service,
    );
    yield* Stream.runHead(Stream.filter(pace.changes, (state) => state.state._tag === 'unavailable'));
    expect(pace.state()).toEqual({ pace: 'lowest', state: { _tag: 'unavailable', reason: 'the host is not the custodian' } });
    yield* TestClock.adjust('30 seconds');
    yield* Stream.runHead(Stream.filter(pace.changes, (state) => state.state._tag === 'applied'));
    expect(pace.state()).toEqual({ pace: 'lowest', state: { _tag: 'applied', pace: 'lowest', reached: 3, kept: 0, failed: 0 } });
  }),
);
