import type { Act, SpeechProtocol } from '@runlith/speech/protocol/codec';
import type { RecognitionModel } from '@runlith/speech/wire/capabilities';
import { SpeechEvent } from '@runlith/speech/wire/events';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import { Result } from 'effect';
import type { Credential } from './credential.ts';
import { base64Of, COMMIT_EMPTY, decode, failureOf, type Reply } from './frames.ts';
import { LIVE, RATE } from './models.ts';

export const ENDPOINT = 'wss://api.openai.com/v1/realtime?intent=transcription';

const COMMIT = JSON.stringify({ type: 'input_audio_buffer.commit' });

export type Speaking = {
  readonly item: string;
  readonly at: number;
};

export type Listening = {
  readonly ready: boolean;
  readonly finishing: boolean;
  readonly sent: number | undefined;
  readonly active: Speaking | undefined;
  readonly stopped: ReadonlyArray<string>;
  readonly pending: number;
  readonly mine: ReadonlyArray<number>;
  readonly open: ReadonlyArray<string>;
  readonly hypotheses: Readonly<Record<string, string>>;
};

const initial: Listening = {
  ready: false,
  finishing: false,
  sent: undefined,
  active: undefined,
  stopped: [],
  pending: 0,
  mine: [],
  open: [],
  hypotheses: {},
};

const turnDetection = (request: RecognitionRequest) => {
  if (request.turns !== 'provider') return null;
  const tuned: Record<string, number> = {};
  for (const key of ['threshold', 'silence_duration_ms']) {
    const value = request.tuning[key];
    if (value !== undefined) tuned[key] = value;
  }
  return { type: 'server_vad', ...tuned };
};

const transcription = (model: RecognitionModel, request: RecognitionRequest) => {
  const prompt = request.prompt;
  if (model.id === LIVE) {
    return {
      model: model.id,
      prompt,
      keywords: request.terms.length === 0 ? undefined : request.terms,
      languages: request.languages.length === 0 ? undefined : request.languages,
    };
  }
  const language = request.languages[0];
  return { model: model.id, prompt, language };
};

export const opening = (model: RecognitionModel, request: RecognitionRequest): string =>
  JSON.stringify({
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: RATE },
          transcription: transcription(model, request),
          turn_detection: model.id === LIVE ? null : turnDetection(request),
        },
      },
    },
  });

const frames = (ms: number): number => Math.round((ms * RATE) / 1000);

const idle = (state: Listening): boolean => state.finishing && state.pending === 0 && state.mine.length === 0 && state.open.length === 0;

const without = (record: Readonly<Record<string, string>>, key: string): Record<string, string> => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

const settle = (state: Listening, events: Array<SpeechEvent>, send: ReadonlyArray<string> = []): Act<Listening> => {
  if (idle(state)) events.push(SpeechEvent.finished);
  return { state, send, events };
};

const closing = (state: Listening, item: string, events: Array<SpeechEvent>): Act<Listening> =>
  settle({ ...state, open: state.open.filter((id) => id !== item), hypotheses: without(state.hypotheses, item) }, events);

const required = (reply: Reply): string | undefined => {
  switch (reply.type) {
    case 'input_audio_buffer.committed':
    case 'conversation.item.input_audio_transcription.failed':
      return reply.item_id === undefined ? 'item_id' : undefined;
    case 'conversation.item.input_audio_transcription.delta':
      return reply.item_id === undefined ? 'item_id' : reply.delta === undefined ? 'delta' : undefined;
    case 'conversation.item.input_audio_transcription.completed':
      return reply.item_id === undefined ? 'item_id' : reply.transcript === undefined ? 'transcript' : undefined;
    default:
      return undefined;
  }
};

const committed = (state: Listening, item: string, events: Array<SpeechEvent>, turns: RecognitionRequest['turns']) => {
  const commit = turns === 'client' ? state.mine[0] : undefined;
  if (commit !== undefined) events.push(SpeechEvent.committed(item, commit));
  const manual = turns === 'provider' && !state.stopped.includes(item);
  const active = state.active;
  if (manual && active !== undefined) {
    if (active.item !== item) events.push(SpeechEvent.turnEnd(active.item), SpeechEvent.speechStart(item, active.at));
    if (state.sent !== undefined) events.push(SpeechEvent.speechEnd(item, state.sent));
  }
  return settle(
    {
      ...state,
      active: manual ? undefined : state.active,
      stopped: state.stopped.filter((id) => id !== item),
      pending: Math.max(0, state.pending - 1),
      mine: commit === undefined ? state.mine : state.mine.slice(1),
      open: [...state.open, item],
    },
    events,
  );
};

export const read = (state: Listening, reply: Reply, turns: RecognitionRequest['turns']): Act<Listening> => {
  const item = reply.item_id;
  const events: Array<SpeechEvent> = [];
  switch (reply.type) {
    case 'session.updated':
      return settle({ ...state, ready: true }, events);
    case 'input_audio_buffer.speech_started': {
      if (item === undefined || reply.audio_start_ms === undefined) return settle(state, events);
      const at = frames(reply.audio_start_ms);
      events.push(SpeechEvent.speechStart(item, at));
      return settle({ ...state, active: { item, at } }, events);
    }
    case 'input_audio_buffer.speech_stopped': {
      if (item !== undefined && reply.audio_end_ms !== undefined) events.push(SpeechEvent.speechEnd(item, frames(reply.audio_end_ms)));
      const expected = item === undefined || !state.open.includes(item);
      return settle(
        {
          ...state,
          active: undefined,
          stopped: item === undefined ? state.stopped : [...state.stopped, item],
          pending: state.pending + (expected ? 1 : 0),
        },
        events,
      );
    }
    case 'input_audio_buffer.committed':
      return item === undefined ? settle(state, events) : committed(state, item, events, turns);
    case 'conversation.item.input_audio_transcription.delta': {
      if (item === undefined || reply.delta === undefined || reply.delta === '') return settle(state, events);
      const text = (state.hypotheses[item] ?? '') + reply.delta;
      events.push(SpeechEvent.partial(item, text));
      return settle({ ...state, hypotheses: { ...state.hypotheses, [item]: text } }, events);
    }
    case 'conversation.item.input_audio_transcription.completed': {
      if (item === undefined) return settle(state, events);
      const transcript = (reply.transcript ?? '').trim();
      if (transcript !== '') events.push(SpeechEvent.final(item, [{ lane: 'source', text: transcript, granularity: 'segment' }]));
      events.push(SpeechEvent.turnEnd(item));
      return closing(state, item, events);
    }
    case 'conversation.item.input_audio_transcription.failed': {
      if (item === undefined) return settle(state, events);
      events.push(SpeechEvent.turnFailed(item, reply.error?.message ?? 'OpenAI could not transcribe this audio'));
      return closing(state, item, events);
    }
    default:
      return settle(state, events);
  }
};

const step = (turns: RecognitionRequest['turns']) => (state: Listening, reply: Reply) => {
  if (reply.type === 'error') {
    if (reply.error?.code !== COMMIT_EMPTY) return Result.fail(failureOf(reply.error));
    return Result.succeed(settle({ ...state, pending: Math.max(0, state.pending - 1), mine: state.mine.slice(1) }, []));
  }
  const missing = required(reply);
  if (missing !== undefined) return Result.fail(SpeechFailure.provider(`OpenAI sent ${reply.type} without ${missing}`, false));
  return Result.succeed(read(state, reply, turns));
};

export const recognition = (
  model: RecognitionModel,
  request: RecognitionRequest,
  credential: Credential,
): SpeechProtocol<Listening, Reply> => ({
  format: { rate: RATE, channels: 1 },
  request: { url: ENDPOINT, headers: { authorization: `Bearer ${credential.apiKey}` }, protocols: [] },
  init: [opening(model, request)],
  initial,
  decode,
  step: step(request.turns),
  ready: (state) => state.ready,
  audio: (pcm) => JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Of(pcm) }),
  commit:
    request.turns === 'client'
      ? (state, commit) => ({
          state: { ...state, pending: state.pending + 1, mine: [...state.mine, commit] },
          send: [COMMIT],
          events: [],
        })
      : undefined,
  finish: (state, sent) => {
    const tail = request.turns === 'provider';
    return settle({ ...state, finishing: true, sent, pending: state.pending + (tail ? 1 : 0) }, [], tail ? [COMMIT] : []);
  },
});
