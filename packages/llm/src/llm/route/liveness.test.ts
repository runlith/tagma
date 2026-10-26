import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Clock, Duration, Effect, Exit, Fiber, Latch, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClientRequest } from 'effect/http';
import { route as anthropic } from '../protocols/anthropic-messages';
import { LLMError } from '../schema/errors';
import { LLMRequest } from '../schema/messages';
import { Model } from '../schema/options';
import type { Route } from './definition';
import * as Framing from './framing';
import { HttpExecutor } from './executor';
import type { HttpPrepared } from './transport/http';
import type { Transport, TransportRuntime } from './transport/index';

type AnthropicBody = typeof anthropic extends Route<infer Body, infer _Prepared> ? Body : never;

const PREPARED: HttpPrepared<string> = {
  request: HttpClientRequest.get('https://liveness.test'),
  framing: Framing.sse,
};

const runtime: TransportRuntime = { http: HttpExecutor.of({ execute: () => Effect.die('scripted frames make no HTTP request') }) };

const over = (frames: Stream.Stream<string, LLMError>) => {
  const transport: Transport<AnthropicBody, HttpPrepared<string>, string> = {
    id: 'frames-under-test',
    prepare: () => Effect.succeed(PREPARED),
    frames: () => frames,
  };
  const route = anthropic.with({ transport });
  const request = new LLMRequest({
    model: Model.make({ id: 'claude-test', provider: 'anthropic', route }),
    system: [],
    messages: [],
    tools: [],
    liveness: WINDOW_MS,
  });
  return Effect.scoped(
    Effect.gen(function* () {
      const lifetime = yield* Scope.make();
      return yield* Stream.runCollect(route.streamPrepared(PREPARED, request, runtime, lifetime)).pipe(
        Effect.ensuring(Scope.close(lifetime, Exit.void)),
      );
    }),
  );
};

const reading = Effect.fnUntraced(function* (work: ReturnType<typeof over>, awakeMs: number) {
  const running = yield* Effect.forkScoped(work);
  yield* TestClock.adjust(Duration.millis(awakeMs));
  return yield* Fiber.join(running);
});

const WINDOW_MS = 60;
const BEAT_MS = 20;

const frame = (payload: Record<string, unknown>) => JSON.stringify(payload);

const beating = (payloads: ReadonlyArray<Record<string, unknown>>) =>
  Stream.fromArray(payloads.map(frame)).pipe(Stream.mapEffect((payload) => Effect.as(Effect.sleep(BEAT_MS), payload))) as Stream.Stream<
    string,
    LLMError
  >;

const ANSWER = [
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
] as const;

class Machine implements Clock.Clock {
  private slept = 0;
  private readonly alarms = new Set<Latch.Latch>();

  constructor(private readonly clock: Clock.Clock) {}

  currentTimeMillisUnsafe(): number {
    return this.clock.currentTimeMillisUnsafe() + this.slept;
  }
  readonly currentTimeMillis = Effect.sync(() => this.currentTimeMillisUnsafe());
  currentTimeNanosUnsafe(): bigint {
    return BigInt(this.currentTimeMillisUnsafe()) * 1_000_000n;
  }
  readonly currentTimeNanos = Effect.sync(() => this.currentTimeNanosUnsafe());
  monotonicTimeNanosUnsafe(): bigint {
    return this.clock.monotonicTimeNanosUnsafe();
  }
  readonly monotonicTimeNanos = Effect.sync(() => this.monotonicTimeNanosUnsafe());

  sleep(duration: Duration.Duration): Effect.Effect<void> {
    return Effect.suspend(() => {
      const alarm = Latch.makeUnsafe(false);
      this.alarms.add(alarm);
      return Effect.raceFirst(this.clock.sleep(duration), alarm.await).pipe(Effect.ensuring(Effect.sync(() => this.alarms.delete(alarm))));
    });
  }

  sleepThrough(ms: number): Effect.Effect<void> {
    return Effect.sync(() => {
      this.slept += ms;
      for (const alarm of [...this.alarms]) alarm.openUnsafe();
    });
  }
}

describe('a call under its liveness window', () => {
  it.effect('survives a machine sleep longer than the window when frames resume once it wakes', () =>
    Effect.gen(function* () {
      const machine = new Machine(yield* Clock.Clock);
      const resumed = Stream.fromEffect(
        machine.sleepThrough(10 * WINDOW_MS).pipe(Effect.andThen(Effect.as(Effect.sleep(BEAT_MS), frame(ANSWER[1])))),
      );
      const events = yield* reading(
        over(Stream.concat(beating([ANSWER[0]]), Stream.concat(resumed, beating(ANSWER.slice(2))))).pipe(
          Effect.provideService(Clock.Clock, machine),
        ),
        ANSWER.length * BEAT_MS,
      );

      expect(events.filter((event) => event.type === 'finish')).toHaveLength(1);
      expect(events.some((event) => event.type === 'text-delta')).toBe(true);
    }),
  );

  it.effect('survives a silence longer than the window when the only frames arriving are pings', () =>
    Effect.gen(function* () {
      const pings = Array.from({ length: 4 }, () => ({ type: 'ping' }));
      const events = yield* reading(over(beating([ANSWER[0], ...pings, ...ANSWER.slice(1)])), (ANSWER.length + pings.length) * BEAT_MS);

      expect(BEAT_MS * pings.length).toBeGreaterThan(WINDOW_MS);
      expect(events.filter((event) => event.type === 'finish')).toHaveLength(1);
      expect(events.some((event) => event.type === 'text-delta')).toBe(true);
    }),
  );

  it.effect('fails with the typed stall when the response head never arrives', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.exit(reading(over(Stream.never), WINDOW_MS));

      expect(Exit.isFailure(outcome)).toBe(true);
      const failure = Exit.isFailure(outcome) ? Cause.squash(outcome.cause) : undefined;
      expect(failure).toBeInstanceOf(LLMError);
      expect((failure as LLMError).reason._tag).toBe('StreamStalled');
      expect((failure as LLMError).reason).toMatchObject({ idleMs: WINDOW_MS });
    }),
  );

  it.effect('fails with the typed stall, carrying its window, when nothing arrives at all', () =>
    Effect.gen(function* () {
      const outcome = yield* Effect.exit(reading(over(Stream.concat(beating([ANSWER[0]]), Stream.never)), WINDOW_MS + BEAT_MS));

      expect(Exit.isFailure(outcome)).toBe(true);
      const failure = Exit.isFailure(outcome) ? Cause.squash(outcome.cause) : undefined;
      expect(failure).toBeInstanceOf(LLMError);
      expect((failure as LLMError).reason._tag).toBe('StreamStalled');
      expect((failure as LLMError).reason).toMatchObject({ idleMs: WINDOW_MS });
      expect((failure as LLMError).retryable).toBe(false);
    }),
  );
});
