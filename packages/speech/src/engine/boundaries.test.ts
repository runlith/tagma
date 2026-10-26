import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Layer, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { Connection, SpeechProvider } from '../protocol/adapter.ts';
import { streaming } from '../testing/models.ts';
import { controlOf, incoming, pcmOf, scriptedProvider } from '../testing/scriptedProvider.ts';
import { event, inWorld, type Listening, play, ready, settle, word } from '../testing/world.ts';
import { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Gap, TrackState, Utterance } from '../wire/heard.ts';
import type { RecognitionChoice } from './choose.ts';
import { listeningDefaults } from './settings.ts';
import { CredentialRefused, SpeechCredentials } from './SpeechCredentials.ts';

const live = streaming('live');
const provider = scriptedProvider({ id: 'scripted', recognition: [live] });
const choice: RecognitionChoice = { provider: 'scripted', model: live, turns: 'provider', wants: {} };
const ones = (count: number) => Array.from({ length: count }, () => 1);

const failureOf = (listening: Listening) => {
  const exit = listening.exit();
  return exit !== undefined && Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
};
const gaps = (listening: Listening) =>
  listening.heard.filter((item): item is Gap => item._tag === 'Gap').map((gap) => [gap.from, gap.to, gap.cause]);
const closed = (listening: Listening) => listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);

it.effect('an invalid-request refusal ends the track at once', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, [1]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* link.receive(incoming({ type: 'error', reason: 'invalid-request', message: 'bad rate' }));
        yield* settle;
        yield* play(listening, [2]);
        return { listening, live: world.transport.live() };
      }),
    );
    expect(failureOf(seen.listening)).toMatchObject({ reason: 'invalid-request' });
    expect(seen.live).toBe(0);
  }),
);

it.effect('a stereo track, an unregistered model and a want the model lacks are refused before any connection', () =>
  Effect.gen(function* () {
    const refusals = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const stereo = yield* world.listen(choice, {}, { rate: 16_000, channels: 2 });
        const stranger = yield* world.listen({ ...choice, provider: 'nobody' });
        const translating = yield* world.listen({ ...choice, wants: { translation: { _tag: 'one-way', target: 'fr' } } });
        yield* settle;
        const reasonOf = (listening: Listening) => {
          const failure = failureOf(listening);
          return failure instanceof SpeechFailure ? failure.reason : undefined;
        };
        return { reasons: [stereo, stranger, translating].map(reasonOf), live: world.transport.live() };
      }),
    );
    expect(refusals).toEqual({ reasons: ['invalid-request', 'invalid-request', 'unsupported'], live: 0 });
  }),
);

it.effect('a track gap drains the segment it closes and opens the next one with the seq going on', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, ones(5));
        const first = yield* world.transport.next;
        yield* first.receive(ready);
        yield* first.receive(event(SpeechEvent.final('a', [word('before', 0, 1_600)])));
        yield* listening.track.skip(200, 'device-change');
        yield* settle;
        yield* first.receive(event(SpeechEvent.turnEnd('a')));
        yield* first.receive(event(SpeechEvent.finished));
        yield* play(listening, ones(5));
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* second.receive(event(SpeechEvent.final('a', [word('after', 0, 1_600)])));
        yield* second.receive(event(SpeechEvent.turnEnd('a')));
        yield* settle;
        return { listening, finish: first.sent.map(controlOf).at(-1) };
      }),
    );
    expect(seen.finish).toEqual({ type: 'finish' });
    expect(gaps(seen.listening)).toEqual([[100, 300, 'device-change']]);
    expect(closed(seen.listening).map((item) => [item.id.segment, item.id.seq, item.text, item.span])).toEqual([
      [1, 1, 'before', { from: 0, to: 100 }],
      [2, 2, 'after', { from: 300, to: 400 }],
    ]);
  }),
);

it.effect('a track at another rate is resampled to the connection and its times stay on the scale', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, {}, { rate: 48_000, channels: 1 });
        yield* play(listening, ones(10), 960);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* link.receive(event(SpeechEvent.final('a', [word('scaled', 1_600, 3_200)])));
        yield* link.receive(event(SpeechEvent.turnEnd('a')));
        yield* settle;
        const frames = link.sent.reduce((total, message) => total + (pcmOf(message)?.length ?? 0), 0);
        return { span: closed(listening)[0]?.span, frames };
      }),
    );
    expect(seen.frames).toBeGreaterThan(3_000);
    expect(seen.span?.from).toBeCloseTo(100, 0);
    expect(seen.span?.to).toBeCloseTo(200, 0);
  }),
);

it.effect('the track reports connecting, live with its queue and waiting with the retry delay', () =>
  Effect.gen(function* () {
    const states = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, [1]);
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* settle;
        yield* play(listening, [1]);
        yield* link.receive(incoming({ type: 'error', reason: 'transport', message: 'reset' }));
        yield* settle;
        return listening.heard.filter((item): item is TrackState => item._tag === 'State');
      }),
    );
    expect(states.map((state) => [state.phase, state.segment, state.retryInMs])).toEqual([
      ['connecting', 1, undefined],
      ['live', 1, undefined],
      ['waiting', undefined, listeningDefaults.retry.baseMs],
    ]);
  }),
);

it.effect('stopping gives no Finished, no tail gap and no finish frame', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice);
        yield* play(listening, ones(3));
        const link = yield* world.transport.next;
        yield* link.receive(ready);
        yield* settle;
        yield* listening.stop;
        return { listening, sent: link.sent.map(controlOf).filter((sent) => sent !== undefined) };
      }),
    );
    expect(seen.listening.heard.filter((item) => item._tag === 'Finished' || item._tag === 'Gap')).toEqual([]);
    expect(seen.sent.map((sent) => sent?.['type'])).toEqual(['init']);
    const exit = seen.listening.exit();
    expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  }),
);

it.effect('audio past the budget before ready is a budget gap, and the same chunk opens the next segment', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([provider], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen(choice, { settings: { ...listeningDefaults, budgetMs: 50 } });
        yield* play(listening, [1, 2, 3]);
        const first = yield* world.transport.next;
        const second = yield* world.transport.next;
        yield* second.receive(ready);
        yield* settle;
        return { listening, first: first.sent.length, second: second.sent.flatMap((message) => [pcmOf(message)?.[0]]) };
      }),
    );
    expect(gaps(seen.listening)).toEqual([[0, 40, 'budget']]);
    expect(seen.first).toBe(1);
    expect(seen.second).toEqual([undefined, 3]);
  }),
);

const ending: SpeechProvider<unknown, never> = {
  id: 'ending',
  label: 'ending',
  credential: { _tag: 'none', value: undefined },
  egress: [],
  availability: () => Effect.succeed({ _tag: 'present' }),
  recognizer: {
    models: [live],
    stream: () =>
      Effect.succeed<Connection>({
        format: { rate: 16_000, channels: 1 },
        send: () => Effect.void,
        commit: () => Effect.void,
        finalize: Effect.void,
        finish: Effect.void,
        delivered: Effect.succeed(0),
        events: Stream.empty,
      }),
  },
};

it.effect('events that end without Finished are a cut, not a finish', () =>
  Effect.gen(function* () {
    const seen = yield* inWorld([ending], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen({ provider: 'ending', model: live, turns: 'provider', wants: {} });
        yield* play(listening, [1]);
        yield* TestClock.adjust(listeningDefaults.retry.baseMs);
        yield* play(listening, [1]);
        return listening;
      }),
    );
    expect(gaps(seen)).toEqual([[0, 20, 'reconnect']]);
  }),
);

it.effect('a credential store that fails for a moment delays the connection instead of ending the track', () =>
  Effect.gen(function* () {
    let asked = 0;
    const flaky = Layer.succeed(SpeechCredentials, {
      get: (provider) => {
        asked += 1;
        return asked === 1
          ? Effect.fail(new CredentialRefused({ provider, code: 'store', message: 'the store is busy', unblock: [], retryable: true }))
          : Effect.succeed({ apiKey: 'key' });
      },
    });
    const seen = yield* inWorld(
      [provider],
      (world) =>
        Effect.gen(function* () {
          const listening = yield* world.listen(choice);
          yield* play(listening, [1]);
          yield* TestClock.adjust(listeningDefaults.retry.baseMs);
          yield* play(listening, [2]);
          yield* world.transport.next;
          return { listening, live: world.transport.live() };
        }),
      undefined,
      flaky,
    );
    expect(gaps(seen.listening)).toEqual([[0, 20, 'reconnect']]);
    expect(seen.live).toBe(1);
  }),
);
