import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import type { RecognitionRequest, SynthesisRequest } from '@runlith/speech/wire/requests';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { Effect, Stream } from 'effect';
import { HttpClient, HttpClientResponse } from 'effect/http';
import { recognitionModels, synthesisModels } from './models.ts';
import { openai } from './provider.ts';

const [live, gpt4o] = recognitionModels;
const [speech] = synthesisModels;
const stream = openai.recognizer?.stream;
const open = openai.synthesizer?.open;
if (live === undefined || gpt4o === undefined || speech === undefined || stream === undefined || open === undefined)
  throw new Error('openai recognizes and synthesizes');

const key = { apiKey: 'sk-test' };

const request = (turns: RecognitionRequest['turns'], extra: Partial<RecognitionRequest> = {}): RecognitionRequest => ({
  turns,
  rate: 24_000,
  languages: [],
  detect: false,
  speakers: false,
  terms: [],
  tuning: {},
  ...extra,
});

const answering = (status: number, payload: string | Uint8Array, headers: Record<string, string> = {}) => {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const client = HttpClient.make((http, url) =>
    Effect.sync(() => {
      const raw = http.body._tag === 'Uint8Array' ? new TextDecoder().decode(http.body.body) : '';
      requests.push({ url: url.toString(), authorization: http.headers.authorization, body: JSON.parse(raw) });
      return HttpClientResponse.fromWeb(http, new Response(payload, { status, headers }));
    }),
  );
  return { client, requests };
};

const silent = answering(204, '').client;

const run = <A, E>(
  body: (transport: Effect.Success<typeof scriptedTransport>) => Effect.Effect<A, E, HttpClient.HttpClient | DuplexTransport>,
  client: HttpClient.HttpClient = silent,
) =>
  Effect.flatMap(scriptedTransport, (transport) =>
    body(transport).pipe(Effect.provide(transport.layer), Effect.provideService(HttpClient.HttpClient, client)),
  );

const text = (message: unknown): Record<string, unknown> => JSON.parse(String(message));

it.effect('the opening frame carries the model, the turn mode and its tuning, and audio waits for the session update', () =>
  Effect.gen(function* () {
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const liveConnection = yield* stream(
            live,
            request('client', { terms: ['AC-42'], languages: ['en', 'fr'], prompt: 'support' }),
            key,
          );
          const liveLink = yield* transport.next;
          yield* liveConnection.send(new Int16Array(240));
          const before = liveLink.sent.length;
          yield* liveLink.receive(JSON.stringify({ type: 'session.created' }));
          yield* Effect.yieldNow;
          const afterCreated = liveLink.sent.length;
          yield* liveLink.receive(JSON.stringify({ type: 'session.updated' }));
          yield* Effect.yieldNow;
          const turned = yield* stream(gpt4o, request('provider', { languages: ['de'], tuning: { silence_duration_ms: 800 } }), key);
          const turnedLink = yield* transport.next;
          const clientOnly = yield* stream(gpt4o, request('client'), key);
          const clientLink = yield* transport.next;
          return { liveLink, before, afterCreated, after: liveLink.sent.length, turnedLink, clientLink, turned, clientOnly };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.liveLink.request).toEqual({
      url: 'wss://api.openai.com/v1/realtime?intent=transcription',
      headers: { authorization: 'Bearer sk-test' },
      protocols: [],
    });
    expect(text(seen.liveLink.sent[0])).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24_000 },
            transcription: { model: 'gpt-live-transcribe', prompt: 'support', keywords: ['AC-42'], languages: ['en', 'fr'] },
            turn_detection: null,
          },
        },
      },
    });
    expect([seen.before, seen.afterCreated, seen.after]).toEqual([1, 1, 2]);
    expect(text(seen.liveLink.sent[1]).type).toBe('input_audio_buffer.append');
    const input = (link: typeof seen.liveLink) => (text(link.sent[0]).session as { audio: { input: Record<string, unknown> } }).audio.input;
    expect(input(seen.turnedLink)).toMatchObject({
      transcription: { model: 'gpt-4o-transcribe', language: 'de' },
      turn_detection: { type: 'server_vad', silence_duration_ms: 800 },
    });
    expect(input(seen.clientLink).turn_detection).toBeNull();
  }),
);

it.effect(
  'a client-mode session built from documented frames replays: commit, deltas, completion and Finished only after every item settles',
  () =>
    Effect.gen(function* () {
      const seen = yield* run((transport) =>
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* stream(live, request('client'), key);
            const link = yield* transport.next;
            yield* link.receive(JSON.stringify({ type: 'session.updated' }));
            yield* connection.send(new Int16Array(2_400));
            yield* connection.commit(7);
            yield* connection.finish;
            yield* link.receive(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'item_1' }));
            yield* link.receive(
              JSON.stringify({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', delta: 'Hello' }),
            );
            const open = link.isClosed();
            yield* link.receive(
              JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'Hello.' }),
            );
            const events = yield* Stream.runCollect(connection.events);
            return {
              events: events.map((event) => event._tag),
              sent: link.sent.slice(1).map((message) => text(message).type),
              open,
              closed: link.isClosed(),
            };
          }),
        ).pipe(Effect.provide(transport.layer)),
      );
      expect(seen.sent).toEqual(['input_audio_buffer.append', 'input_audio_buffer.commit']);
      expect(seen.events).toEqual(['Committed', 'Partial', 'Final', 'TurnEnd', 'Finished']);
      expect(seen.open).toBe(false);
      expect(seen.closed).toBe(true);
    }),
);

it.effect('a hang-up while a commit is unanswered is a transport cut, never Finished', () =>
  Effect.gen(function* () {
    const cut = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* stream(live, request('client'), key);
          const link = yield* transport.next;
          yield* link.receive(JSON.stringify({ type: 'session.updated' }));
          yield* connection.commit(1);
          yield* connection.finish;
          yield* link.hangUp;
          return yield* Effect.flip(Stream.runCollect(connection.events));
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(cut.reason).toBe('transport');
  }),
);

const speaking = (over: Partial<SynthesisRequest> = {}): SynthesisRequest => ({
  voice: 'coral',
  rate: 24_000,
  timestamps: false,
  ...over,
});

it.effect('synthesis posts the whole text once at the end and streams whole samples of the answer', () =>
  Effect.gen(function* () {
    const pcm = Int16Array.from([5, -6, 7, 8]);
    const bytes = new Uint8Array(pcm.buffer);
    const { client, requests } = answering(200, bytes);
    const spoken = yield* run(
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const synthesis = yield* open(speech, speaking({ instructions: 'warm' }), key);
            yield* synthesis.say('Hello ');
            yield* synthesis.say('there.');
            expect(requests).toEqual([]);
            yield* synthesis.end;
            return Array.from(yield* Stream.runCollect(synthesis.audio));
          }),
        ),
      client,
    );
    expect(requests).toEqual([
      {
        url: 'https://api.openai.com/v1/audio/speech',
        authorization: 'Bearer sk-test',
        body: { model: 'gpt-4o-mini-tts', input: 'Hello there.', voice: 'coral', response_format: 'pcm', instructions: 'warm' },
      },
    ]);
    expect(spoken.flatMap((chunk) => (chunk._tag === 'Audio' ? Array.from(chunk.pcm) : []))).toEqual([5, -6, 7, 8]);
  }),
);

it.effect('a refused synthesis request ends the audio with a typed failure carrying the retry delay', () =>
  Effect.gen(function* () {
    const { client } = answering(429, JSON.stringify({ error: { message: 'slow down' } }), { 'retry-after': '3' });
    const failure = yield* run(
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const synthesis = yield* open(speech, speaking(), key);
            yield* synthesis.say('Hi.');
            yield* synthesis.end;
            return yield* Effect.flip(Stream.runCollect(synthesis.audio));
          }),
        ),
      client,
    );
    expect(failure).toMatchObject({ reason: 'rate', message: 'slow down', retryAfterMs: 3_000 });
  }),
);
