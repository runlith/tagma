import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect, Fiber, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { STOP_LADDER, type StopStep } from './protocol/call';
import { climb, type LadderAim } from './stopLadder';

it.effect('escalates only at each ladder boundary and records the step that ended each remaining aim', () =>
  Effect.gen(function* () {
    const sent = yield* Queue.unbounded<{ readonly step: StopStep; readonly at: number }>();
    const began = yield* Clock.currentTimeMillis;
    const steps: StopStep[] = [];
    const endings: ReadonlyArray<StopStep | 'unsignalled' | undefined> = ['unsignalled', 'interrupt', 'terminate', 'kill', undefined];
    const aims: LadderAim[] = endings.map((ending, index) => ({
      send: Effect.fnUntraced(function* (step) {
        if (index === 4) {
          steps.push(step);
          yield* Queue.offer(sent, { step, at: (yield* Clock.currentTimeMillis) - began });
        }
      }),
      gone: Effect.sync(() => ending === 'unsignalled' || (ending !== undefined && steps.includes(ending))),
    }));
    const stopping = yield* Effect.forkScoped(climb('interrupt', aims));
    expect(yield* Queue.take(sent)).toEqual({ step: 'interrupt', at: 0 });
    yield* TestClock.adjust(STOP_LADDER.terminateAtMs - 1);
    expect(steps).toEqual(['interrupt']);
    yield* TestClock.adjust(1);
    expect(yield* Queue.take(sent)).toEqual({ step: 'terminate', at: STOP_LADDER.terminateAtMs });
    yield* TestClock.adjust(STOP_LADDER.killAtMs - STOP_LADDER.terminateAtMs - 1);
    expect(steps).toEqual(['interrupt', 'terminate']);
    yield* TestClock.adjust(1);
    expect(yield* Queue.take(sent)).toEqual({ step: 'kill', at: STOP_LADDER.killAtMs });
    yield* TestClock.adjust(STOP_LADDER.reapMs);
    expect(yield* Fiber.join(stopping)).toEqual({
      steps: ['interrupt', 'terminate', 'kill'],
      endedAt: ['unsignalled', 'interrupt', 'terminate', 'kill', undefined],
      opened: true,
    });
  }),
);

it.effect('finishes on the first observed exit without sending a later signal', () =>
  Effect.gen(function* () {
    const sent = yield* Queue.unbounded<StopStep>();
    let ended = false;
    const stopping = yield* Effect.forkScoped(
      climb('hang-up', [
        {
          send: Effect.fnUntraced(function* (step) {
            ended = true;
            yield* Queue.offer(sent, step);
          }),
          gone: Effect.sync(() => ended),
        },
      ]),
    );
    expect(yield* Queue.take(sent)).toBe('hang-up');
    yield* TestClock.adjust(STOP_LADDER.terminateAtMs - 1);
    expect(yield* Fiber.join(stopping)).toEqual({ steps: ['hang-up'], endedAt: ['hang-up'], opened: true });
    expect(Queue.sizeUnsafe(sent)).toBe(0);
  }),
);
