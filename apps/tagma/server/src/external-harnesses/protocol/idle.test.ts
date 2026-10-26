import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Duration, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { BACKGROUND } from '../contract/wire/extensions.js';
import { IDLE_MS, idleResource, idling, resting } from './idle.js';
import type { Link } from './links.js';
import { background } from './methods/background.js';
import { freshRow, type ProtocolRow } from './row.js';

const HOUR = Duration.millis(IDLE_MS);

const atRest = (row: Partial<ProtocolRow> = {}): Link =>
  ({
    row: { ...freshRow('incarnation', null, null), phase: 'ready', ...row },
    facet: { session: { state: 'running' }, question: null },
  }) as unknown as Link;

const watched = (link: Link, releases: readonly boolean[], during: (asked: number) => void = () => {}) => {
  const released: number[] = [];
  let at = 0;
  const release = Effect.map(Clock.currentTimeMillis, (now) => {
    released.push(now);
    during(at);
    const answer = releases[Math.min(at, releases.length - 1)]!;
    at += 1;
    return answer;
  });
  return { released, fiber: Effect.forkScoped(idling(link, release, IDLE_MS)) };
};

const silent = (): Link => ({ activeAt: 0 }) as unknown as Link;

it.effect('a process silent for the idle hour is released, and not a moment before', () =>
  Effect.gen(function* () {
    const watch = watched(silent(), [true]);
    const fiber = yield* watch.fiber;
    yield* TestClock.adjust(Duration.millis(IDLE_MS - 1));
    expect(watch.released).toEqual([]);
    yield* TestClock.adjust(Duration.millis(1));
    yield* Fiber.join(fiber);
    expect(watch.released).toEqual([IDLE_MS]);
  }),
);

it.effect('activity inside the hour starts the hour again', () =>
  Effect.gen(function* () {
    const link = silent();
    const watch = watched(link, [true]);
    const fiber = yield* watch.fiber;
    yield* TestClock.adjust(Duration.minutes(40));
    link.activeAt = 40 * 60 * 1000;
    yield* TestClock.adjust(Duration.minutes(20));
    expect(watch.released).toEqual([]);
    yield* TestClock.adjust(Duration.minutes(40));
    yield* Fiber.join(fiber);
    expect(watch.released).toEqual([100 * 60 * 1000]);
  }),
);

it.effect('a refused release is asked again after another hour', () =>
  Effect.gen(function* () {
    const watch = watched(silent(), [false, true]);
    const fiber = yield* watch.fiber;
    yield* TestClock.adjust(HOUR);
    expect(watch.released).toEqual([IDLE_MS]);
    yield* TestClock.adjust(HOUR);
    yield* Fiber.join(fiber);
    expect(watch.released).toEqual([IDLE_MS, 2 * IDLE_MS]);
  }),
);

it.effect('a release refused because activity arrived is asked again an hour after that activity', () =>
  Effect.gen(function* () {
    const link = silent();
    const watch = watched(link, [false, true], (asked) => {
      if (asked === 0) link.activeAt = IDLE_MS + 10 * 60 * 1000;
    });
    const fiber = yield* watch.fiber;
    yield* TestClock.adjust(HOUR);
    yield* TestClock.adjust(Duration.minutes(69));
    expect(watch.released).toEqual([IDLE_MS]);
    yield* TestClock.adjust(Duration.minutes(1));
    yield* Fiber.join(fiber);
    expect(watch.released).toEqual([IDLE_MS, 2 * IDLE_MS + 10 * 60 * 1000]);
  }),
);

test('a process between turns is resting; an open turn, a pending vendor request or background work keep it', () => {
  expect(resting(atRest())).toBe(true);
  expect(resting(atRest({ background: 2 }))).toBe(false);
  expect(resting(atRest({ compact: { turn: 't', request: 'r', ids: [], mode: 'manual', noticed: false } }))).toBe(false);
  expect(resting(atRest({ phase: 'opening' }))).toBe(false);
  expect(resting(atRest({ turns: [{ id: 'run' } as never] }))).toBe(false);
  const fresh = freshRow('incarnation', null, null);
  expect(resting(atRest({ client: { ...fresh.client, asks: [{ id: 'ask' } as never] } }))).toBe(false);
});

test('the runner background notice sets the count that keeps the process, and zero releases it', () => {
  const notice = (running: number) => ({ _tag: 'Extended' as const, id: 'n', method: BACKGROUND, params: { sessionId: 's', running } });
  const row = freshRow('incarnation', null, null);
  const busy = background.noticed(row, notice(2), '');
  expect(busy.row.background).toBe(2);
  expect(background.noticed(busy.row, notice(0), '').row.background).toBe(0);
});

const resource = (activity: Effect.Effect<'exited' | 'output'>, since: Effect.Effect<number>, answers: readonly boolean[]) => {
  const released: number[] = [];
  let at = 0;
  const release = Effect.map(Clock.currentTimeMillis, (now) => {
    released.push(now);
    return answers[Math.min(at++, answers.length - 1)]!;
  });
  return { released, fiber: Effect.forkScoped(idleResource(since, activity, release, IDLE_MS)) };
};

it.effect('a runless process counts its hour from its persisted activity, and output inside the hour ends the wait instead', () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(10 * 60 * 1000);
    const waiting = resource(Effect.never, Effect.succeed(5 * 60 * 1000), [true]);
    const released = yield* waiting.fiber;
    yield* TestClock.adjust(Duration.millis(IDLE_MS - 5 * 60 * 1000 - 1));
    expect(waiting.released).toEqual([]);
    yield* TestClock.adjust(Duration.millis(1));
    expect(yield* Fiber.join(released)).toBe('released');
    const heard = resource(Effect.sleep(Duration.minutes(30)).pipe(Effect.as('output' as const)), Effect.succeed(65 * 60 * 1000), [true]);
    const second = yield* heard.fiber;
    yield* TestClock.adjust(Duration.minutes(30));
    expect(yield* Fiber.join(second)).toBe('output');
    expect(heard.released).toEqual([]);
  }),
);

it.effect('a refused resource release is asked again an hour later, not at once', () =>
  Effect.gen(function* () {
    const waiting = resource(Effect.never, Effect.succeed(0), [false, true]);
    const fiber = yield* waiting.fiber;
    yield* TestClock.adjust(HOUR);
    expect(waiting.released).toEqual([IDLE_MS]);
    yield* TestClock.adjust(Duration.millis(IDLE_MS - 1));
    expect(waiting.released).toHaveLength(1);
    yield* TestClock.adjust(Duration.millis(1));
    yield* Fiber.join(fiber);
    expect(waiting.released).toEqual([IDLE_MS, 2 * IDLE_MS]);
  }),
);
