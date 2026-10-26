import type { Message } from '@runlith/speech/protocol/transport';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import { Result, Schema } from 'effect';

const Failure = Schema.Struct({
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
  type: Schema.optionalKey(Schema.NullOr(Schema.String)),
  code: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
});
export type Failure = typeof Failure.Type;

const Reply = Schema.Struct({
  type: Schema.String,
  item_id: Schema.optional(Schema.String),
  delta: Schema.optional(Schema.String),
  transcript: Schema.optional(Schema.String),
  audio_start_ms: Schema.optional(Schema.Number),
  audio_end_ms: Schema.optional(Schema.Number),
  error: Schema.optional(Failure),
});
export type Reply = typeof Reply.Type;

const decodeReply = Schema.decodeUnknownResult(Reply);

export const decode = (message: Message): Result.Result<Reply, SpeechFailure> => {
  if (typeof message !== 'string') return Result.fail(SpeechFailure.provider('OpenAI sent a binary frame', false));
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return Result.fail(SpeechFailure.provider('OpenAI sent a frame that is not JSON', false));
  }
  return Result.mapError(decodeReply(json), (error) =>
    SpeechFailure.provider(`OpenAI sent a frame of an unknown shape: ${error.message}`, false),
  );
};

export const COMMIT_EMPTY = 'input_audio_buffer_commit_empty';

export const failureOf = (failure: Failure | undefined): SpeechFailure => {
  const message = failure?.message ?? 'OpenAI returned an error.';
  const code = failure?.code === undefined || failure.code === null ? undefined : String(failure.code);
  if (code === 'invalid_api_key' || failure?.type === 'authentication_error') return SpeechFailure.auth(message);
  if (code === 'insufficient_quota') return new SpeechFailure({ reason: 'rate', message, retryable: false });
  if (code === 'rate_limit_exceeded') return SpeechFailure.rate(message);
  if (failure?.type === 'invalid_request_error') return SpeechFailure.invalidRequest(message);
  return SpeechFailure.provider(message, failure?.type === 'server_error');
};

export const failureOfStatus = (status: number, message: string | undefined, retryAfterMs?: number): SpeechFailure => {
  const text = message ?? `OpenAI answered ${status}.`;
  if (status === 401 || status === 403) return SpeechFailure.auth(text);
  if (status === 429) return SpeechFailure.rate(text, retryAfterMs);
  if (status === 400 || status === 404 || status === 422) return SpeechFailure.invalidRequest(text);
  return SpeechFailure.provider(text, status >= 500);
};

export const base64Of = (pcm: Int16Array): string => {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
};
