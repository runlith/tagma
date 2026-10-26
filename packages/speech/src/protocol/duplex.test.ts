import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Stream } from 'effect';
import { controlOf, incoming, pcmOf, scriptedProvider } from '../testing/scriptedProvider.ts';
import { scriptedTransport } from '../testing/ScriptedTransport.ts';
import type { RecognitionModel } from '../wire/capabilities.ts';
import { SpeechEvent } from '../wire/events.ts';
import type { Overflow, SpeechFailure } from '../wire/failure.ts';
import type { RecognitionRequest } from '../wire/requests.ts';
import { DuplexLimits } from './duplex.ts';

const model: RecognitionModel = {
  id: 'live',
  label: 'Live',
  recognition: {
    kind: 'stream',
    rates: [16_000],
    partials: true,
    turns: ['provider', 'client'],
    finalize: true,
    timestamps: 'word',
    speakers: false,
    confidence: false,
    languages: { codes: ['en'], hints: 1, detect: false },
    prompting: { prompt: false, terms: false },
    limits: {},
    tuning: [],
  },
};

const request: RecognitionRequest = {
  turns: 'client',
  rate: 16_000,
  languages: [],
  detect: false,
  speakers: false,
  terms: [],
  tuning: {},
};

const provider = scriptedProvider({ id: 'scripted', recognition: [model] });
const stream = provider.recognizer?.stream;
if (stream === undefined) throw new Error('the scripted provider streams');

const pcm = (value: number, frames: number) => new Int16Array(frames).fill(value);

it.effect('the opening frames carry the request and audio waits for the provider to be ready', () =>
  Effect.gen(function* () {
    const transport = yield* scriptedTransport;
    const seen = yield* Effect.gen(function* () {
      const connection = yield* stream(model, request, { apiKey: 'k-1' });
      const link = yield* transport.next;
      yield* connection.send(pcm(1, 160));
      yield* connection.commit(1);
      yield* connection.send(pcm(2, 160));
      const before = [...link.sent];
      yield* link.receive(incoming({ type: 'ready' }));
      yield* Effect.yieldNow;
      yield* connection.send(pcm(3, 160));
      return { link, before, after: [...link.sent] };
    }).pipe(Effect.provide(transport.layer));
    expect(seen.link.request.headers).toEqual({ authorization: 'k-1' });
    expect(seen.before.map(controlOf)).toEqual([{ type: 'init', model: 'live', turns: 'client', rate: 16_000 }]);
    expect(seen.after.slice(1).map((message) => pcmOf(message)?.[0] ?? controlOf(message))).toEqual([
      1,
      { type: 'commit', commit: 1 },
      2,
      3,
    ]);
  }),
);

it.effect('a vendor error ends the events with its typed failure and refuses further audio', () =>
  Effect.gen(function* () {
    const transport = yield* scriptedTransport;
    const seen = yield* Effect.gen(function* () {
      const connection = yield* stream(model, request, { apiKey: 'k' });
      const link = yield* transport.next;
      yield* link.receive(incoming({ type: 'ready' }));
      yield* link.receive(incoming({ type: 'error', reason: 'auth', message: 'bad key' }));
      const events = yield* Effect.exit(Stream.runCollect(connection.events));
      const send = yield* Effect.exit(connection.send(pcm(1, 16)));
      return { events, send };
    }).pipe(Effect.provide(transport.layer));
    const failure = (exit: Exit.Exit<unknown, SpeechFailure | Overflow>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);
    expect(failure(seen.events)).toMatchObject({ _tag: 'SpeechFailure', reason: 'auth' });
    expect(failure(seen.send)).toMatchObject({ _tag: 'SpeechFailure', reason: 'auth' });
  }),
);

it.effect('the events end only on the provider Finished; a hang-up before it is a cut', () =>
  Effect.gen(function* () {
    const transport = yield* scriptedTransport;
    const seen = yield* Effect.gen(function* () {
      const first = yield* stream(model, request, { apiKey: 'k' });
      const one = yield* transport.next;
      yield* one.receive(incoming({ type: 'ready' }));
      yield* first.finish;
      yield* one.receive(incoming({ type: 'event', event: SpeechEvent.turnEnd('a') }));
      yield* one.receive(incoming({ type: 'event', event: SpeechEvent.finished }));
      const finished = yield* Stream.runCollect(first.events);
      const second = yield* stream(model, request, { apiKey: 'k' });
      const two = yield* transport.next;
      yield* two.receive(incoming({ type: 'ready' }));
      yield* second.finish;
      yield* two.hangUp;
      const cut = yield* Effect.flip(Stream.runCollect(second.events));
      return { finished, cut, closed: one.isClosed() };
    }).pipe(Effect.provide(transport.layer));
    expect(seen.finished.map((event) => event._tag)).toEqual(['TurnEnd', 'Finished']);
    expect(seen.closed).toBe(true);
    expect(seen.cut.reason).toBe('transport');
  }),
);

it.effect('audio past the budget before ready is refused as an overflow', () =>
  Effect.gen(function* () {
    const transport = yield* scriptedTransport;
    const seen = yield* Effect.gen(function* () {
      const connection = yield* stream(model, request, { apiKey: 'k' });
      yield* connection.send(pcm(1, 1_600));
      const over = yield* Effect.flip(connection.send(pcm(1, 1)));
      return { over, delivered: yield* connection.delivered };
    }).pipe(Effect.provide(transport.layer), Effect.provideService(DuplexLimits, { budgetMs: 100, readyMs: 15_000 }));
    expect(seen.over._tag).toBe('Overflow');
    expect(seen.delivered).toBe(0);
  }),
);
