import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import { inWorld, offline, play, settle } from '@runlith/speech/testing/world';
import type { Utterance } from '@runlith/speech/wire/heard';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Effect, Stream } from 'effect';
import { HttpClient } from 'effect/http';
import { recognitionModels, synthesisModels } from './models.ts';
import { soniox } from './provider.ts';

const model = recognitionModels[0];
const voice = synthesisModels[0];
const stream = soniox.recognizer?.stream;
const open = soniox.synthesizer?.open;
if (model === undefined || voice === undefined || stream === undefined || open === undefined)
  throw new Error('soniox recognizes and synthesizes');

const key = { apiKey: 'sk-test' };

const request: RecognitionRequest = {
  turns: 'provider',
  rate: 16_000,
  languages: ['en', 'es'],
  detect: true,
  speakers: true,
  prompt: 'a clinic visit',
  terms: ['Celebrex'],
  translation: { _tag: 'one-way', target: 'de' },
  tuning: { max_endpoint_delay_ms: 800, endpoint_sensitivity: 0.5 },
};

const run = <A, E>(body: (transport: Effect.Success<typeof scriptedTransport>) => Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.provideService(Effect.flatMap(scriptedTransport, body), HttpClient.HttpClient, offline);

const text = (message: unknown): Record<string, unknown> => JSON.parse(String(message));

it.effect('the opening frame carries the request, the model and the turn mode; audio follows it at once', () =>
  Effect.gen(function* () {
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* stream(model, request, key);
          const link = yield* transport.next;
          yield* connection.send(new Int16Array(160));
          const second = yield* stream(model, { ...request, turns: 'none', tuning: {} }, key);
          const other = yield* transport.next;
          yield* second.send(new Int16Array(160));
          return { link, other };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.link.request.url).toBe('wss://stt-rt.soniox.com/transcribe-websocket');
    expect(text(seen.link.sent[0])).toEqual({
      api_key: 'sk-test',
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 16_000,
      num_channels: 1,
      enable_speaker_diarization: true,
      enable_language_identification: true,
      language_hints: ['en', 'es'],
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: 800,
      endpoint_sensitivity: 0.5,
      context: { text: 'a clinic visit', terms: ['Celebrex'] },
      translation: { type: 'one_way', target_language: 'de' },
    });
    expect(typeof seen.link.sent[1]).not.toBe('string');
    expect(text(seen.other.sent[0]).enable_endpoint_detection).toBe(false);
  }),
);

it.effect('a session built from documented frames replays to its events and ends only on the vendor finished reply', () =>
  Effect.gen(function* () {
    const frame = (tokens: ReadonlyArray<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ tokens, ...extra });
    const word = (value: string, from: number, to: number, isFinal: boolean) => ({
      text: value,
      start_ms: from,
      end_ms: to,
      is_final: isFinal,
      speaker: '1',
    });
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* stream(model, { ...request, translation: undefined }, key);
          const link = yield* transport.next;
          yield* connection.send(new Int16Array(1_600));
          yield* link.receive(frame([word('Good', 0, 200, false)]));
          yield* link.receive(frame([word('Good', 0, 200, true), word(' day', 200, 400, false)]));
          yield* link.receive(frame([word(' day', 200, 400, true), word('<end>', 400, 400, true)]));
          yield* connection.finish;
          yield* link.receive(frame([], { finished: true }));
          const events = yield* Stream.runCollect(connection.events);
          return { events: events.map((event) => event._tag), sent: link.sent.slice(2), closed: link.isClosed() };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.events).toEqual(['Partial', 'Final', 'Partial', 'Final', 'TurnEnd', 'Finished']);
    expect(seen.sent).toEqual(['']);
    expect(seen.closed).toBe(true);
  }),
);

it.effect('a listening that names no language asks Soniox to identify it, and the units carry the language Soniox sends', () =>
  Effect.gen(function* () {
    const heard = yield* inWorld([soniox], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen({ provider: 'soniox', model, turns: 'provider', wants: {} });
        yield* play(listening, [100]);
        const link = yield* world.transport.next;
        const opening = text(link.sent[0]);
        yield* link.receive(
          JSON.stringify({
            tokens: [
              { text: 'Hola', start_ms: 0, end_ms: 15, is_final: true, language: 'es' },
              { text: '<end>', is_final: true },
            ],
          }),
        );
        yield* settle;
        const closed = listening.heard.filter((item): item is Utterance => item._tag === 'Utterance' && item.closed);
        return {
          identify: opening['enable_language_identification'],
          languages: closed.flatMap((item) => item.units.map((unit) => unit.language)),
        };
      }),
    );
    expect(heard).toEqual({ identify: true, languages: ['es'] });
  }),
);

it.effect('a hinted listening still asks Soniox to identify the language, beside the hints', () =>
  Effect.gen(function* () {
    const opening = yield* inWorld([soniox], (world) =>
      Effect.gen(function* () {
        const listening = yield* world.listen({ provider: 'soniox', model, turns: 'provider', wants: { languages: ['en', 'es'] } });
        yield* play(listening, [100]);
        const link = yield* world.transport.next;
        return text(link.sent[0]);
      }),
    );
    expect(opening).toMatchObject({ enable_language_identification: true, language_hints: ['en', 'es'] });
  }),
);

it.effect('a hang-up before the vendor finished is a transport cut, never Finished', () =>
  Effect.gen(function* () {
    const cut = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* stream(model, request, key);
          const link = yield* transport.next;
          yield* connection.finish;
          yield* link.hangUp;
          return yield* Effect.flip(Stream.runCollect(connection.events));
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(cut.reason).toBe('transport');
  }),
);

it.effect('finalize sends the vendor control message and the vendor error frame ends the stream with its failure', () =>
  Effect.gen(function* () {
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* stream(model, request, key);
          const link = yield* transport.next;
          yield* connection.finalize;
          yield* link.receive(JSON.stringify({ tokens: [], error_code: 429, error_message: 'too many' }));
          const failure = yield* Effect.flip(Stream.runCollect(connection.events));
          return { failure, sent: link.sent.slice(1).map(text) };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.sent).toEqual([{ type: 'finalize' }]);
    expect(seen.failure).toMatchObject({ reason: 'rate', retryable: true });
  }),
);

it.effect('synthesis opens a stream, sends text in pieces and the end, and plays the base64 audio until terminated', () =>
  Effect.gen(function* () {
    const pcm = Int16Array.from([1, -2, 3, 4]);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const synthesis = yield* open(voice, { voice: 'Adrian', rate: 24_000, language: 'en', timestamps: false }, key);
          const link = yield* transport.next;
          yield* synthesis.say('Hello ');
          yield* synthesis.say('there.');
          yield* synthesis.end;
          yield* link.receive(JSON.stringify({ audio: base64, audio_end: false, stream_id: '1' }));
          yield* link.receive(JSON.stringify({ audio: '', audio_end: true, stream_id: '1' }));
          yield* link.receive(JSON.stringify({ terminated: true, stream_id: '1' }));
          const spoken = yield* Stream.runCollect(synthesis.audio);
          return { link, spoken: Array.from(spoken) };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.link.request.url).toBe('wss://tts-rt.soniox.com/tts-websocket');
    expect(seen.link.sent.map(text)).toEqual([
      {
        api_key: 'sk-test',
        model: 'tts-rt-v2',
        voice: 'Adrian',
        audio_format: 'pcm_s16le',
        sample_rate: 24_000,
        stream_id: '1',
        language: 'en',
      },
      { text: 'Hello ', text_end: false, stream_id: '1' },
      { text: 'there.', text_end: false, stream_id: '1' },
      { text: '', text_end: true, stream_id: '1' },
    ]);
    expect(seen.spoken).toEqual([{ _tag: 'Audio', pcm }]);
  }),
);

it.effect('audio that is not base64 ends the audio stream with a typed provider failure', () =>
  Effect.gen(function* () {
    const failure = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const synthesis = yield* open(voice, { voice: 'Adrian', rate: 24_000, language: 'en', timestamps: false }, key);
          const link = yield* transport.next;
          yield* link.receive(JSON.stringify({ audio: '!', stream_id: '1' }));
          return yield* Effect.flip(Stream.runCollect(synthesis.audio));
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(failure).toMatchObject({ reason: 'provider', retryable: false });
  }),
);

it.effect('synthesis without the language of the text is refused before any connection is opened', () =>
  Effect.gen(function* () {
    const seen = yield* run((transport) =>
      Effect.scoped(
        Effect.gen(function* () {
          const refused = yield* Effect.flip(open(voice, { voice: 'Adrian', rate: 24_000, timestamps: false }, key));
          return { refused, opened: transport.live() };
        }),
      ).pipe(Effect.provide(transport.layer)),
    );
    expect(seen.refused).toMatchObject({ reason: 'invalid-request' });
    expect(seen.opened).toBe(0);
  }),
);
