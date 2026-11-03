import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClientError, HttpClientRequest } from 'effect/http';
import type { Startup, StartupState } from '../contract/wire/restart.js';
import { type Spawned, awaitRestart, awaitStart, requestRestart } from './serverStart.js';

const spawned = (fields: Partial<Spawned> = {}): Spawned => ({
  pid: 4242,
  exitCode: null,
  signalCode: null,
  ...fields,
});

const nobody = (): number | null => null;
const unsaid = () => Effect.void;
const unread: StartupState = { startup: null, issue: null };
const accepted: StartupState = { ...unread, restart: { id: 'restart', stage: 'accepted', underway: true, failure: null, stays: false } };
const serving: StartupState = { ...unread, restart: { id: 'restart', stage: 'serving', underway: false, failure: null, stays: false } };
const successor = (answer: string) => answer === 'new';
const target = { isSuccessor: successor, build: (answer: string) => answer, expected: 'new' };
const failed: Startup = {
  pid: 4242,
  startedAt: 0,
  readyAt: null,
  expectedMs: null,
  step: null,
  status: 'failed',
  phase: 'migration',
  failure: { phase: 'migration', at: 1, detail: 'migration refused' },
};

it.effect('a spawned server that leaves before answering is named by its exit code', () =>
  Effect.gen(function* () {
    expect(yield* awaitStart(spawned({ exitCode: 1 }), Effect.succeed(null), nobody, Effect.succeed(unread), unsaid)).toEqual({
      _tag: 'Left',
      code: 1,
    });
  }),
);

it.effect('a spawned server killed before answering is named by its signal', () =>
  Effect.gen(function* () {
    expect(yield* awaitStart(spawned({ signalCode: 'SIGKILL' }), Effect.succeed(null), nobody, Effect.succeed(unread), unsaid)).toEqual({
      _tag: 'Signalled',
      signal: 'SIGKILL',
    });
  }),
);

it.effect('a live start remains pending through a minute of silence and ends when the server answers', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitStart(
        spawned(),
        Effect.sync(() => answer),
        () => 4242,
        Effect.succeed(unread),
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'up';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'up', raised: true });
  }),
);

it.effect('a failed startup record ends the wait with its cause while the spawned process is alive', () =>
  Effect.gen(function* () {
    const outcome = yield* awaitStart(spawned(), Effect.succeed(null), () => 4242, Effect.succeed({ ...unread, startup: failed }), unsaid);
    expect(outcome).toEqual({ _tag: 'Failed', detail: 'migration refused' });
  }),
);

it.effect('a failed record of a previous process does not condemn a fresh start', () =>
  Effect.gen(function* () {
    const outcome = yield* awaitStart(
      spawned(),
      Effect.succeed('up'),
      nobody,
      Effect.succeed({ ...unread, startup: { ...failed, pid: 111 } }),
      unsaid,
    );
    expect(outcome).toEqual({ _tag: 'Answered', answered: 'up', raised: true });
  }),
);

it.effect('a held directory is adopted after the spawned process exits even when its pid was reused', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitStart(
        spawned({ exitCode: 1 }),
        Effect.sync(() => answer),
        () => 4242,
        Effect.succeed(unread),
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'winner';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'winner', raised: false });
  }),
);

it.effect('a live restart participant bridges the gap between a spawned predecessor and its successor', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitStart(
        spawned({ exitCode: 0 }),
        Effect.sync(() => answer),
        nobody,
        Effect.succeed(accepted),
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'successor';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'successor', raised: false });
  }),
);

it.effect('a restart can succeed without an observed interval of silence', () =>
  Effect.gen(function* () {
    let saved = accepted;
    const waiting = yield* Effect.forkChild(
      awaitRestart(
        Effect.succeed('answer'),
        () => 4242,
        Effect.sync(() => saved),
        { isSuccessor: () => false, build: (answer) => answer, expected: 'answer' },
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    saved = serving;
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'answer' });
  }),
);

it.effect('a silent restart remains pending while a process holds the directory and resolves when its successor answers', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitRestart(
        Effect.sync(() => answer),
        () => 5151,
        Effect.succeed(accepted),
        target,
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'new';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'new' });
  }),
);

it.effect('a live restart participant keeps the wait pending even while the directory has no holder', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitRestart(
        Effect.sync(() => answer),
        nobody,
        Effect.succeed(accepted),
        target,
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'new';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'new' });
  }),
);

it.effect('a restart refuses on silence when nobody holds the directory and no live handover remains', () =>
  Effect.gen(function* () {
    const abandoned: StartupState = { ...accepted, restart: { ...accepted.restart!, underway: false } };
    expect(yield* awaitRestart(Effect.succeed(null), nobody, Effect.succeed(abandoned), target, unsaid)).toEqual({ _tag: 'Silent' });
  }),
);

it.effect('a recorded restart failure wins over an old server that still answers', () =>
  Effect.gen(function* () {
    const saved: StartupState = {
      ...unread,
      restart: { id: 'restart', stage: 'failed', underway: false, failure: 'successor exited', stays: true },
    };
    expect(yield* awaitRestart(Effect.succeed('old'), () => 4242, Effect.succeed(saved), target, unsaid)).toEqual({
      _tag: 'Failed',
      detail: 'successor exited',
    });
  }),
);

it.effect('a different process serving the previous build is a failed restart', () =>
  Effect.gen(function* () {
    const outcome = yield* awaitRestart(
      Effect.succeed({ pid: 5151, build: 'old-build' }),
      nobody,
      Effect.succeed(unread),
      { isSuccessor: (answer) => answer.pid !== 4242, build: (answer) => answer.build, expected: 'new-build' },
      unsaid,
    );
    expect(outcome).toEqual({ _tag: 'Failed', detail: 'came back on old-build instead of new-build' });
  }),
);

it.effect('an unnamed flock holder is waited on until the desired successor answers', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitRestart(
        Effect.sync(() => answer),
        () => 'unnamed',
        Effect.succeed(unread),
        target,
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'new';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'new' });
  }),
);

it.effect('a lost restart answer is accepted by the new restart record rather than retried', () =>
  Effect.gen(function* () {
    const lost = new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request: HttpClientRequest.post('http://127.0.0.1/restart') }),
    });
    const outcome = yield* requestRestart(Effect.fail(lost), unread, Effect.succeed(accepted));
    expect(outcome).toBeNull();
  }),
);

it.effect('a lost request with no recorded acceptance and no local owner returns its transport failure', () =>
  Effect.gen(function* () {
    const lost = new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request: HttpClientRequest.post('http://127.0.0.1/restart') }),
    });
    const waiting = yield* Effect.forkChild(Effect.result(requestRestart(Effect.fail(lost), unread, Effect.succeed(unread), nobody)));
    yield* TestClock.adjust('0 millis');
    expect(waiting.pollUnsafe()).toBeDefined();
    const outcome = yield* Fiber.join(waiting);
    expect(outcome._tag).toBe('Failure');
    if (outcome._tag === 'Failure') expect(outcome.failure).toBe(lost);
  }),
);

it.effect('a declared restart refusal is preserved when the request was answered', () =>
  Effect.gen(function* () {
    const refused = { code: 'host-unprepared', reason: 'the host refused preparation', unblock: ['read the host state'] };
    const outcome = yield* Effect.result(requestRestart(Effect.fail(refused), unread, Effect.succeed(accepted)));
    expect(outcome._tag).toBe('Failure');
    if (outcome._tag === 'Failure') expect(outcome.failure).toBe(refused);
  }),
);

it.effect('unknown remote liveness is waited on until the answering process changes', () =>
  Effect.gen(function* () {
    let answer: string | null = null;
    const waiting = yield* Effect.forkChild(
      awaitRestart(
        Effect.sync(() => answer),
        null,
        Effect.succeed(unread),
        target,
        unsaid,
      ),
    );
    yield* TestClock.adjust('1 minute');
    expect(waiting.pollUnsafe()).toBeUndefined();
    answer = 'new';
    yield* TestClock.adjust('100 millis');
    expect(yield* Fiber.join(waiting)).toEqual({ _tag: 'Answered', answered: 'new' });
  }),
);
