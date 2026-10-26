import type { Act, SpeechProtocol } from '@runlith/speech/protocol/codec';
import type { RecognitionModel } from '@runlith/speech/wire/capabilities';
import { SpeechEvent, type Unit } from '@runlith/speech/wire/events';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Result } from 'effect';
import type { Credential } from './credential.ts';
import { decode, failureOf, pcmBytes, type Reply, type Token, unitOf } from './frames.ts';

export type Listening = {
  readonly turn: number;
  readonly open: boolean;
  readonly provisional: boolean;
};

export const ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';

const END_MARKER = '<end>';
const FINAL_MARKER = '<fin>';
const TUNED = ['max_endpoint_delay_ms', 'endpoint_sensitivity', 'endpoint_latency_adjustment_level'] as const;

const context = (request: RecognitionRequest) => {
  const text = request.prompt;
  const terms = request.terms.length === 0 ? undefined : request.terms;
  return text === undefined && terms === undefined ? {} : { context: { text, terms } };
};

const translation = (request: RecognitionRequest) => {
  const wanted = request.translation;
  if (wanted === undefined) return {};
  return wanted._tag === 'one-way'
    ? { translation: { type: 'one_way', target_language: wanted.target } }
    : { translation: { type: 'two_way', language_a: wanted.a, language_b: wanted.b } };
};

const endpointing = (request: RecognitionRequest) => {
  if (request.turns !== 'provider') return { enable_endpoint_detection: false };
  const tuned: Record<string, number> = {};
  for (const key of TUNED) {
    const value = request.tuning[key];
    if (value !== undefined) tuned[key] = value;
  }
  return { enable_endpoint_detection: true, ...tuned };
};

export const opening = (model: RecognitionModel, request: RecognitionRequest, credential: Credential): string =>
  JSON.stringify({
    api_key: credential.apiKey,
    model: model.id,
    audio_format: 'pcm_s16le',
    sample_rate: request.rate,
    num_channels: 1,
    enable_speaker_diarization: request.speakers,
    enable_language_identification: request.detect,
    language_hints: request.languages.length === 0 ? undefined : request.languages,
    ...endpointing(request),
    ...context(request),
    ...translation(request),
  });

const markerOf = (token: Token): 'end' | 'fin' | undefined => {
  const text = token.text.trim();
  if (text === END_MARKER) return 'end';
  if (text === FINAL_MARKER) return 'fin';
  return undefined;
};

export const read = (state: Listening, reply: Reply, rate: number): Act<Listening> => {
  const events: Array<SpeechEvent> = [];
  let turn = state.turn;
  let open = state.open;
  let provisional = state.provisional;
  let stable: Array<Unit> = [];
  let hypothesis = '';

  const settle = () => {
    if (stable.length === 0) return;
    events.push(SpeechEvent.final(String(turn), stable));
    stable = [];
    open = true;
    provisional = false;
  };

  for (const token of reply.tokens ?? []) {
    if (token.is_audio_event === true) continue;
    const marker = markerOf(token);
    if (marker === 'end') {
      settle();
      if (open) {
        events.push(SpeechEvent.turnEnd(String(turn)));
        turn += 1;
      }
      open = false;
      provisional = false;
      hypothesis = '';
    } else if (marker === 'fin') {
      settle();
      events.push(SpeechEvent.finalized);
    } else if (token.is_final === true) {
      stable.push(unitOf(token, rate));
    } else if (token.translation_status !== 'translation') {
      hypothesis += token.text;
    }
  }
  settle();
  if (hypothesis.trim() !== '' || (hypothesis !== '' && provisional)) {
    events.push(SpeechEvent.partial(String(turn), hypothesis));
    provisional = true;
    open = open || hypothesis.trim() !== '';
  } else if (provisional) {
    events.push(SpeechEvent.partial(String(turn), ''));
    provisional = false;
  }
  if (reply.finished === true) {
    if (open) events.push(SpeechEvent.turnEnd(String(turn)));
    events.push(SpeechEvent.finished);
  }
  return { state: { turn, open, provisional }, send: [], events };
};

const quiet = (state: Listening, ...send: ReadonlyArray<string>): Act<Listening> => ({ state, send, events: [] });

export const recognition = (
  model: RecognitionModel,
  request: RecognitionRequest,
  credential: Credential,
): SpeechProtocol<Listening, Reply> => ({
  format: { rate: request.rate, channels: 1 },
  request: { url: ENDPOINT, headers: {}, protocols: [] },
  init: [opening(model, request, credential)],
  initial: { turn: 0, open: false, provisional: false },
  decode,
  step: (state, reply) =>
    reply.error_code === undefined ? Result.succeed(read(state, reply, request.rate)) : Result.fail(failureOf(reply)),
  ready: () => true,
  audio: pcmBytes,
  finalize: (state) => quiet(state, JSON.stringify({ type: 'finalize' })),
  finish: (state) => quiet(state, ''),
  keepalive: { everyMs: 10_000, message: JSON.stringify({ type: 'keepalive' }) },
});
