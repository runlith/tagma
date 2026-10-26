import type { Message } from '@runlith/speech/protocol/transport';
import type { Unit } from '@runlith/speech/wire/events';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import { Result, Schema } from 'effect';

export const Token = Schema.Struct({
  text: Schema.String,
  start_ms: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  end_ms: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  confidence: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  is_final: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  is_audio_event: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  speaker: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  language: Schema.optionalKey(Schema.NullOr(Schema.String)),
  source_language: Schema.optionalKey(Schema.NullOr(Schema.String)),
  translation_status: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type Token = typeof Token.Type;

const speakerOf = (token: Token): string | undefined =>
  token.speaker === undefined || token.speaker === null ? undefined : String(token.speaker);

const framesAt = (ms: number, rate: number): number => Math.round((ms * rate) / 1000);

export const unitOf = (token: Token, rate: number): Unit => {
  const speaker = speakerOf(token);
  if (token.translation_status === 'translation') {
    return {
      lane: 'translation',
      text: token.text,
      granularity: 'token',
      language: token.language ?? undefined,
      origin: token.source_language ?? undefined,
      speaker,
    };
  }
  const start = token.start_ms;
  const end = token.end_ms;
  return {
    lane: 'source',
    text: token.text,
    granularity: 'token',
    time:
      start === undefined || start === null || end === undefined || end === null
        ? undefined
        : { from: framesAt(start, rate), to: framesAt(end, rate) },
    speaker,
    language: token.language ?? undefined,
    confidence: token.confidence ?? undefined,
  };
};

export const refusalFields = {
  error_code: Schema.optional(Schema.Number),
  error_type: Schema.optional(Schema.String),
  error_message: Schema.optional(Schema.String),
  request_id: Schema.optional(Schema.String),
};

export type Refusal = {
  readonly error_code?: number | undefined;
  readonly error_type?: string | undefined;
  readonly error_message?: string | undefined;
  readonly request_id?: string | undefined;
};

const Reply = Schema.Struct({
  tokens: Schema.optional(Schema.Array(Token)),
  finished: Schema.optional(Schema.Boolean),
  ...refusalFields,
});
export type Reply = typeof Reply.Type;

export const decoderOf = <A>(schema: Schema.Decoder<A>) => {
  const decodeFrame = Schema.decodeUnknownResult(schema);
  return (message: Message): Result.Result<A, SpeechFailure> => {
    if (typeof message !== 'string') return Result.fail(SpeechFailure.provider('Soniox sent a binary frame', false));
    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      return Result.fail(SpeechFailure.provider('Soniox sent a frame that is not JSON', false));
    }
    return Result.mapError(decodeFrame(json), (error) =>
      SpeechFailure.provider(`Soniox sent a frame of an unknown shape: ${error.message}`, false),
    );
  };
};

const BUDGETS = ['organization_balance_exhausted', 'organization_monthly_budget_exhausted', 'project_monthly_budget_exhausted'];

const byType = (type: string, text: string): SpeechFailure | undefined => {
  if (type === 'unauthenticated' || type === 'permission_denied' || type === 'temp_api_key_session_expired')
    return SpeechFailure.auth(text);
  if (BUDGETS.includes(type)) return new SpeechFailure({ reason: 'rate', message: text, retryable: false });
  if (type === 'limit_exceeded') return SpeechFailure.rate(text);
  if (type === 'invalid_request' || type === 'model_not_available') return SpeechFailure.invalidRequest(text);
  if (type === 'request_timeout' || type === 'internal_error' || type === 'service_unavailable' || type === 'max_duration_reached')
    return SpeechFailure.transport(text);
  if (type === 'max_audio_duration_reached') return SpeechFailure.provider(text, false);
  return undefined;
};

const byCode = (code: number, text: string): SpeechFailure => {
  if (code === 401 || code === 403) return SpeechFailure.auth(text);
  if (code === 402) return new SpeechFailure({ reason: 'rate', message: text, retryable: false });
  if (code === 429) return SpeechFailure.rate(text);
  if (code === 400) return SpeechFailure.invalidRequest(text);
  if (code === 408 || code === 413 || code === 500 || code === 503) return SpeechFailure.transport(text);
  return SpeechFailure.provider(text, false);
};

export const failureOf = (refusal: Refusal): SpeechFailure => {
  const code = refusal.error_code ?? 0;
  const base = refusal.error_message ?? `Soniox error (${code}).`;
  const text = refusal.request_id === undefined ? base : `${base} (request ${refusal.request_id})`;
  return (refusal.error_type === undefined ? undefined : byType(refusal.error_type, text)) ?? byCode(code, text);
};

export const decode = decoderOf(Reply);

export const pcmBytes = (pcm: Int16Array): Uint8Array => new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
