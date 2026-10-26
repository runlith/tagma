import type { Synthesis } from '@runlith/speech/protocol/adapter';
import type { SynthesisModel } from '@runlith/speech/wire/capabilities';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { SynthesisRequest } from '@runlith/speech/wire/requests';
import { type Cause, Effect, Queue, type Scope, Stream } from 'effect';
import { HttpClient, HttpClientRequest, type HttpClientResponse } from 'effect/http';
import type { Credential } from './credential.ts';
import { failureOfStatus } from './frames.ts';
import { INSTRUCTED, RATE } from './models.ts';

export const ENDPOINT = 'https://api.openai.com/v1/audio/speech';

type Spoken = { readonly _tag: 'Audio'; readonly pcm: Int16Array };

export const body = (model: SynthesisModel, request: SynthesisRequest, text: string) => ({
  model: model.id,
  input: text,
  voice: request.voice,
  response_format: 'pcm',
  instructions: model.id === INSTRUCTED ? request.instructions : undefined,
});

const wholeSamples = (carry: Uint8Array, bytes: Uint8Array) => {
  const joined = new Uint8Array(carry.byteLength + bytes.byteLength);
  joined.set(carry, 0);
  joined.set(bytes, carry.byteLength);
  const whole = joined.byteLength - (joined.byteLength % 2);
  const view = new DataView(joined.buffer, joined.byteOffset, whole);
  const pcm = new Int16Array(whole / 2);
  for (let index = 0; index < pcm.length; index++) pcm[index] = view.getInt16(index * 2, true);
  return { pcm, carry: joined.slice(whole) };
};

const messageOf = (text: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed.error;
      if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message;
    }
  } catch {
    return text === '' ? undefined : text;
  }
  return undefined;
};

const refused = Effect.fn('openai.speech.refused')(function* (response: HttpClientResponse.HttpClientResponse) {
  const retry = Number(response.headers['retry-after']);
  const failure = (message: string | undefined) =>
    failureOfStatus(response.status, message, Number.isFinite(retry) ? retry * 1000 : undefined);
  return yield* Effect.match(response.text, {
    onFailure: (error) => failure(`OpenAI speech refusal body could not be read: ${error.message}`),
    onSuccess: (text) => failure(messageOf(text)),
  });
});

export const synthesis = Effect.fn('openai.speech.synthesis')(function* (
  model: SynthesisModel,
  request: SynthesisRequest,
  credential: Credential,
): Effect.fn.Return<Synthesis, never, Scope.Scope | HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const output = yield* Queue.unbounded<Spoken, SpeechFailure | Cause.Done>();
  yield* Effect.addFinalizer(() => Queue.shutdown(output));
  const pieces: Array<string> = [];
  let ended = false;

  const fetch = Effect.gen(function* () {
    const http = HttpClientRequest.post(ENDPOINT).pipe(
      HttpClientRequest.setHeaders({ authorization: `Bearer ${credential.apiKey}` }),
      HttpClientRequest.bodyJsonUnsafe(body(model, request, pieces.join(''))),
    );
    const response = yield* client.execute(http);
    if (response.status < 200 || response.status >= 300) return yield* Effect.fail(yield* refused(response));
    let carry = new Uint8Array(0);
    yield* Stream.runForEach(response.stream, (bytes) => {
      const assembled = wholeSamples(carry, bytes);
      carry = assembled.carry;
      return assembled.pcm.length === 0 ? Effect.void : Queue.offer(output, { _tag: 'Audio', pcm: assembled.pcm });
    });
    if (carry.byteLength > 0) return yield* Effect.fail(SpeechFailure.provider('the speech ended inside a sample', false));
  }).pipe(
    Effect.mapError((failure) =>
      failure instanceof SpeechFailure ? failure : SpeechFailure.transport(`OpenAI speech request failed: ${failure.message}`),
    ),
    Effect.withSpan('openai.speech.fetch'),
  );

  const run = Effect.matchEffect(fetch, {
    onFailure: (failure) => Queue.fail(output, failure),
    onSuccess: () => Queue.end(output),
  });

  const synthesized: Synthesis = {
    format: { rate: RATE, channels: 1 },
    say: (text) =>
      ended ? Effect.fail(SpeechFailure.invalidRequest('the synthesis has ended')) : Effect.sync(() => void pieces.push(text)),
    end: Effect.suspend(() => {
      if (ended) return Effect.fail(SpeechFailure.invalidRequest('the synthesis has ended'));
      ended = true;
      return Effect.asVoid(Effect.forkIn(run, scope));
    }),
    audio: Stream.fromQueue(output),
  };
  return synthesized;
});
