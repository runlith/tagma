import type { SynthesisAct, SynthesisProtocol } from '@runlith/speech/protocol/codec';
import type { SynthesisModel } from '@runlith/speech/wire/capabilities';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { SynthesisRequest } from '@runlith/speech/wire/requests';
import { Result, Schema } from 'effect';
import type { Credential } from './credential.ts';
import { decoderOf, failureOf, refusalFields } from './frames.ts';

export const ENDPOINT = 'wss://tts-rt.soniox.com/tts-websocket';

const STREAM = '1';

const Reply = Schema.Struct({
  audio: Schema.optional(Schema.String),
  audio_end: Schema.optional(Schema.Boolean),
  terminated: Schema.optional(Schema.Boolean),
  ...refusalFields,
});
export type Reply = typeof Reply.Type;

const decode = decoderOf(Reply);

export type Speaking = { readonly ended: boolean };

const bytesOf = (base64: string): Result.Result<Uint8Array, SpeechFailure> => {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return Result.fail(SpeechFailure.provider('Soniox sent audio that is not base64', false));
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return Result.succeed(bytes);
};

const act = (state: Speaking, ...send: ReadonlyArray<string>): SynthesisAct<Speaking> => ({
  state,
  send,
  audio: [],
  marks: [],
  done: false,
});

export const opening = (model: SynthesisModel, request: SynthesisRequest, credential: Credential): string =>
  JSON.stringify({
    api_key: credential.apiKey,
    model: model.id,
    voice: request.voice,
    audio_format: 'pcm_s16le',
    sample_rate: request.rate,
    stream_id: STREAM,
    language: request.language,
  });

export const synthesis = (
  model: SynthesisModel,
  request: SynthesisRequest,
  credential: Credential,
): SynthesisProtocol<Speaking, Reply> => ({
  format: { rate: request.rate, channels: 1 },
  request: { url: ENDPOINT, headers: {}, protocols: [] },
  init: [opening(model, request, credential)],
  initial: { ended: false },
  decode,
  step: (state, reply) => {
    if (reply.error_code !== undefined) return Result.fail(failureOf(reply));
    const done = reply.terminated === true;
    if (reply.audio === undefined || reply.audio === '') return Result.succeed({ state, send: [], audio: [], marks: [], done });
    return Result.map(bytesOf(reply.audio), (bytes) => ({ state, send: [], audio: [bytes], marks: [], done }));
  },
  ready: () => true,
  say: (state, text) => (text === '' ? act(state) : act(state, JSON.stringify({ text, text_end: false, stream_id: STREAM }))),
  end: (state) => act({ ended: true }, JSON.stringify({ text: '', text_end: true, stream_id: STREAM })),
});
