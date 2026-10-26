import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import type { Recorded } from '@runlith/speech/protocol/adapter';
import type { DuplexTransport } from '@runlith/speech/protocol/transport';
import { scriptedTransport } from '@runlith/speech/testing/ScriptedTransport';
import type { FileEvent } from '@runlith/speech/wire/events';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Clock, Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { HttpClient, type HttpClientRequest, HttpClientResponse } from 'effect/http';
import { recognitionModels } from './models.ts';
import { soniox } from './provider.ts';

const model = recognitionModels.find((one) => one.id === 'stt-async-v5');
const recognizer = soniox.recognizer;
if (model === undefined || recognizer?.file === undefined || recognizer.resume === undefined) throw new Error('soniox hears files');
const { file, resume } = recognizer;

const key = { apiKey: 'sk-test' };

const request: RecognitionRequest = {
  turns: 'none',
  rate: 16_000,
  languages: ['en'],
  detect: true,
  speakers: true,
  terms: [],
  tuning: {},
};

const recorded: Recorded = {
  mime: 'audio/ogg',
  bytes: Stream.make(new TextEncoder().encode('OggS-sound')),
  size: 10,
  format: { rate: 16_000, channels: 1 },
  durationMs: 3_000,
  reference: 'call/system',
};

type Call = { readonly method: string; readonly path: string; readonly body: string };

const said = [
  { text: 'Hello', start_ms: 0, end_ms: 400, speaker: '1', language: 'en' },
  { text: ' there', start_ms: 400, end_ms: 800, speaker: '1', language: 'en' },
  { text: ' Hi', start_ms: 2_000, end_ms: 2_300, speaker: '2', language: 'en' },
];

const bodyOf = (http: HttpClientRequest.HttpClientRequest): Effect.Effect<string> => {
  const body = http.body;
  if (body._tag === 'Uint8Array') return Effect.succeed(new TextDecoder().decode(body.body));
  if (body._tag !== 'Stream') return Effect.succeed('');
  return Stream.runCollect(body.stream).pipe(
    Effect.map((parts) => parts.map((part) => new TextDecoder().decode(part)).join('')),
    Effect.orDie,
  );
};

const vendor = (transcript: unknown = { tokens: said }, busy = 0) => {
  const calls: Array<Call> = [];
  let refused = 0;
  const answer = (call: Call): Response => {
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });
    if (call.method === 'POST' && call.path === '/v1/files') return json(201, { id: 'f1' });
    if (call.method === 'POST' && call.path === '/v1/transcriptions') return json(201, { id: 't1' });
    if (call.method === 'GET' && call.path === '/v1/transcriptions/t1') return json(200, { id: 't1', status: 'completed' });
    if (call.method === 'GET' && call.path === '/v1/transcriptions/t1/transcript') return json(200, transcript);
    if (call.method === 'DELETE' && call.path === '/v1/transcriptions/t1' && refused < busy) {
      refused += 1;
      return json(409, { error_type: 'invalid_state', message: 'still processing' });
    }
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    return json(404, { error_type: 'not_found', message: `no ${call.path}` });
  };
  const client = HttpClient.make((http, url) =>
    Effect.map(bodyOf(http), (body) => {
      const call = { method: http.method, path: url.pathname, body };
      calls.push(call);
      return HttpClientResponse.fromWeb(http, answer(call));
    }),
  );
  return { client, calls };
};

const reaching = <A, E>(work: Effect.Effect<A, E, HttpClient.HttpClient | DuplexTransport>, client: HttpClient.HttpClient) =>
  Effect.flatMap(scriptedTransport, (transport) =>
    work.pipe(Effect.provide(transport.layer), Effect.provideService(HttpClient.HttpClient, client)),
  );

const collected = (stream: Stream.Stream<FileEvent, unknown, HttpClient.HttpClient | DuplexTransport>, client: HttpClient.HttpClient) =>
  reaching(Stream.runCollect(stream), client);

const removals = (calls: ReadonlyArray<Call>) => calls.filter((call) => call.method === 'DELETE').map((call) => call.path);

it.effect('the job is named before the first poll, the tokens become timed units with their speakers, and the work is removed after', () =>
  Effect.gen(function* () {
    const { client, calls } = vendor();
    let named = -1;
    const events = yield* collected(
      Stream.tap(file(model, recorded, request, key), (event) =>
        Effect.sync(() => {
          if (event._tag === 'Job') named = calls.length;
        }),
      ),
      client,
    );
    expect(named).toBe(2);
    expect(events.map((event) => event._tag)).toEqual(['Job', 'Final', 'TurnEnd', 'Finished']);
    const final = events.find((event) => event._tag === 'Final');
    expect(
      final?._tag === 'Final' && final.units.map((unit) => (unit.lane === 'source' ? [unit.text, unit.speaker, unit.time] : null)),
    ).toEqual([
      ['Hello', '1', { from: 0, to: 6_400 }],
      [' there', '1', { from: 6_400, to: 12_800 }],
      [' Hi', '2', { from: 32_000, to: 36_800 }],
    ]);
    expect(calls[0]?.body).toContain('OggS-sound');
    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({
      model: 'stt-async-v5',
      file_id: 'f1',
      enable_speaker_diarization: true,
      enable_language_identification: true,
      language_hints: ['en'],
      client_reference_id: 'call/system',
    });
    expect(removals(calls)).toEqual(['/v1/transcriptions/t1', '/v1/files/f1']);
  }),
);

it.effect('work cut off after its job was named stays with the vendor, and resuming it by the token reads the result and removes it', () =>
  Effect.gen(function* () {
    const { client, calls } = vendor();
    const [job] = yield* collected(Stream.take(file(model, recorded, request, key), 1), client);
    expect(removals(calls)).toEqual([]);
    if (job?._tag !== 'Job') return yield* Effect.die('the job comes first');
    const events = yield* collected(resume(model, job.token, key), client);
    expect(events.map((event) => event._tag)).toEqual(['Final', 'TurnEnd', 'Finished']);
    expect(removals(calls)).toEqual(['/v1/transcriptions/t1', '/v1/files/f1']);
  }),
);

it.effect('dropping work Soniox still processes waits for the processing to end and removes the transcription and its file', () =>
  Effect.gen(function* () {
    const { client, calls } = vendor({ tokens: said }, 1);
    const [job] = yield* collected(Stream.take(file(model, recorded, request, key), 1), client);
    if (job?._tag !== 'Job' || recognizer.discard === undefined) return yield* Effect.die('the job comes first and can be dropped');
    yield* reaching(recognizer.discard(job.token, key), client);
    expect(removals(calls)).toEqual(['/v1/transcriptions/t1', '/v1/transcriptions/t1', '/v1/files/f1']);
  }),
);

it.effect('a final quota refusal near the transcription deadline keeps its nonretryable reason', () =>
  Effect.gen(function* () {
    const base = vendor();
    const began = yield* Clock.currentTimeMillis;
    const client = HttpClient.make((http, url) =>
      url.pathname === '/v1/transcriptions/t1' && http.method === 'GET'
        ? Effect.map(Clock.currentTimeMillis, (now) =>
            HttpClientResponse.fromWeb(
              http,
              now - began < 296_000
                ? new Response(JSON.stringify({ status: 'processing' }), { status: 200 })
                : new Response(JSON.stringify({ error_type: 'organization_balance_exhausted', message: 'balance exhausted' }), {
                    status: 429,
                  }),
            ),
          )
        : base.client.execute(http),
    );
    const running = yield* Effect.forkScoped(reaching(Effect.flip(Stream.runCollect(file(model, recorded, request, key))), client));
    yield* TestClock.adjust('5 minutes');
    const failure = yield* Fiber.join(running);
    expect(failure).toMatchObject({ reason: 'rate', retryable: false, message: 'balance exhausted' });
    expect(removals(base.calls)).toEqual(['/v1/transcriptions/t1', '/v1/files/f1']);
  }),
);

it.effect('a transcript Soniox answers in an unknown shape fails the work and still removes it', () =>
  Effect.gen(function* () {
    const { client, calls } = vendor({ tokens: 'none' });
    const failure = yield* reaching(Effect.flip(Stream.runCollect(file(model, recorded, request, key))), client);
    expect(failure).toMatchObject({ reason: 'provider', retryable: false });
    expect(removals(calls)).toEqual(['/v1/transcriptions/t1', '/v1/files/f1']);
  }),
);
