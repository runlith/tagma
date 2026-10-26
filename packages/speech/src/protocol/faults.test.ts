import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Fiber, Result, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { streaming } from '../testing/models.ts';
import { controlOf, incoming, type ScriptedProvider, scriptedProvider } from '../testing/scriptedProvider.ts';
import { scriptedTransport } from '../testing/ScriptedTransport.ts';
import { SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { RecognitionRequest } from '../wire/requests.ts';
import type { SpeechProtocol } from './codec.ts';
import { duplex } from './duplex.ts';
import type { DuplexTransport } from './transport.ts';

const model = streaming('live');
const request: RecognitionRequest = {
  turns: 'provider',
  rate: 16_000,
  languages: [],
  detect: false,
  speakers: false,
  terms: [],
  tuning: {},
};
const pcm = (frames: number) => new Int16Array(frames).fill(7);

const streamOf = (script: Partial<ScriptedProvider> = {}) => {
  const stream = scriptedProvider({ id: 'scripted', recognition: [model], ...script }).recognizer?.stream;
  if (stream === undefined) throw new Error('the scripted provider streams');
  return stream;
};

const inTransport = <A, E>(
  body: (transport: Effect.Success<typeof scriptedTransport>) => Effect.Effect<A, E, Scope.Scope | DuplexTransport>,
) => Effect.flatMap(scriptedTransport, (transport) => body(transport).pipe(Effect.provide(transport.layer)));

it.effect('empty audio never reaches the wire', () =>
  Effect.gen(function* () {
    const sent = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* streamOf()(model, request, { apiKey: 'k' });
        const link = yield* transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* connection.send(new Int16Array(0));
        return link.sent.length;
      }),
    );
    expect(sent).toBe(1);
  }),
);

it.effect('a provider that never becomes ready fails the connection at the ready deadline', () =>
  Effect.gen(function* () {
    const seen = yield* inTransport(() =>
      Effect.gen(function* () {
        const connection = yield* streamOf()(model, request, { apiKey: 'k' });
        const events = yield* Effect.forkChild(Stream.runCollect(connection.events));
        yield* TestClock.adjust(14_999);
        const early = yield* Effect.yieldNow.pipe(Effect.andThen(Fiber.join(events)), Effect.timeoutOption(0));
        yield* TestClock.adjust(1);
        return { early, late: yield* Effect.flip(Fiber.join(events)) };
      }),
    );
    expect(seen.early._tag).toBe('None');
    expect(seen.late.reason).toBe('transport');
  }),
);

it.effect('a connection that became ready outlives the ready deadline and keeps taking audio', () =>
  Effect.gen(function* () {
    const seen = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* streamOf()(model, request, { apiKey: 'k' });
        const link = yield* transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* TestClock.adjust(20_000);
        return yield* Effect.result(connection.send(pcm(160)));
      }),
    );
    expect(seen._tag).toBe('Success');
  }),
);

it.effect('keepalive beats on outbound silence even while frames arrive, and stops after finish', () =>
  Effect.gen(function* () {
    const keepalive = { everyMs: 1_000, message: JSON.stringify({ type: 'keepalive' }) };
    const beats = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* streamOf({ keepalive })(model, request, { apiKey: 'k' });
        const link = yield* transport.next;
        yield* link.receive(incoming({ type: 'ready' }));
        yield* TestClock.adjust(500);
        yield* link.receive(incoming({ type: 'event', event: SpeechEvent.partial('t', 'a') }));
        yield* TestClock.adjust(500);
        yield* connection.finish;
        yield* TestClock.adjust(3_000);
        return link.sent.map(controlOf).filter((sent) => sent?.['type'] === 'keepalive').length;
      }),
    );
    expect(beats).toBe(1);
  }),
);

it.effect('audio flushed after ready teaches the executor its frame size, so delivered reads the transport buffer right', () =>
  Effect.gen(function* () {
    const delivered = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* streamOf({ encoding: 'json' })(model, request, { apiKey: 'k' });
        const link = yield* transport.next;
        yield* connection.send(pcm(160));
        yield* connection.send(pcm(160));
        yield* link.receive(incoming({ type: 'ready' }));
        yield* Effect.yieldNow;
        const last = link.sent.at(-1);
        link.setBuffered(typeof last === 'string' ? last.length : 0);
        return yield* connection.delivered;
      }),
    );
    expect(delivered).toBe(160);
  }),
);

it.effect('closing the connection scope ends its events instead of leaving the reader waiting', () =>
  Effect.gen(function* () {
    const exit = yield* inTransport((transport) =>
      Effect.gen(function* () {
        yield* transport.hold;
        const scope = yield* Scope.make();
        const connection = yield* Scope.provide(streamOf()(model, request, { apiKey: 'k' }), scope);
        const reader = yield* Effect.forkChild(Stream.runCollect(connection.events));
        yield* Effect.yieldNow;
        yield* Scope.close(scope, Exit.void);
        return yield* Fiber.await(reader);
      }),
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  }),
);

const raw = (step: SpeechProtocol<null, string>['step']): SpeechProtocol<null, string> => ({
  format: { rate: 16_000, channels: 1 },
  request: { url: 'scripted://raw', headers: {}, protocols: [] },
  init: [],
  initial: null,
  decode: (message) => Result.succeed(typeof message === 'string' ? message : ''),
  step,
  ready: () => true,
  audio: () => '',
  finish: (state) => ({ state, send: [], events: [] }),
});

it.effect('a defect in the protocol fails the events instead of leaving them open', () =>
  Effect.gen(function* () {
    const exit = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* duplex(
          raw(() => {
            throw new Error('the codec broke');
          }),
        );
        const link = yield* transport.next;
        yield* link.receive('frame');
        return yield* Effect.exit(Stream.runCollect(connection.events));
      }),
    );
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
  }),
);

it.effect('the events of an act are delivered before the failure of its own send', () =>
  Effect.gen(function* () {
    const exit = yield* inTransport((transport) =>
      Effect.gen(function* () {
        const connection = yield* duplex(
          raw((state) => Result.succeed({ state, send: ['reply'], events: [SpeechEvent.partial('t', 'kept')] })),
        );
        const link = yield* transport.next;
        link.breakSends(SpeechFailure.transport('reset'));
        yield* link.receive('frame');
        const events: Array<SpeechEvent> = [];
        const read = yield* Effect.exit(Stream.runForEach(connection.events, (event) => Effect.sync(() => events.push(event))));
        return { events, read };
      }),
    );
    expect(exit.events).toEqual([SpeechEvent.partial('t', 'kept')]);
    expect(Exit.isFailure(exit.read)).toBe(true);
  }),
);
