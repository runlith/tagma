import type { Availability } from '@runlith/audio/port/devices';
import { Effect, Result, Schema, type Stream } from 'effect';
import type { Clip, Recorded, SpeechProvider } from '../protocol/adapter.ts';
import type { Act, Keepalive, SpeechProtocol, SynthesisProtocol } from '../protocol/codec.ts';
import { duplex } from '../protocol/duplex.ts';
import { synthesisDuplex } from '../protocol/synthesisDuplex.ts';
import type { DuplexTransport, Message } from '../protocol/transport.ts';
import type { RecognitionModel, SynthesisModel } from '../wire/capabilities.ts';
import type { FileEvent, SpeechEvent } from '../wire/events.ts';
import { type FailureReason, SpeechFailure } from '../wire/failure.ts';
import type { RecognitionRequest, SynthesisRequest } from '../wire/requests.ts';

export const Key = Schema.Struct({ apiKey: Schema.String });
export type Key = typeof Key.Type;

export type Incoming =
  | { readonly type: 'ready' }
  | { readonly type: 'event'; readonly event: SpeechEvent }
  | { readonly type: 'error'; readonly reason: FailureReason; readonly message: string; readonly retryAfterMs?: number }
  | { readonly type: 'audio'; readonly pcm: ReadonlyArray<number> }
  | { readonly type: 'bytes'; readonly bytes: ReadonlyArray<number> }
  | { readonly type: 'marks'; readonly text: string; readonly from: number; readonly to: number }
  | { readonly type: 'done' };

export const incoming = (frame: Incoming): string => JSON.stringify(frame);

type Sent = { readonly type?: string; readonly pcm?: ReadonlyArray<number> };

export const pcmOf = (message: Message): Int16Array | undefined => {
  if (typeof message !== 'string') return new Int16Array(message.buffer, message.byteOffset, message.byteLength / 2);
  const sent = JSON.parse(message) as Sent;
  return sent.type === 'audio' && sent.pcm !== undefined ? Int16Array.from(sent.pcm) : undefined;
};

export const controlOf = (message: Message): Record<string, unknown> | undefined => {
  if (typeof message !== 'string') return undefined;
  const sent = JSON.parse(message) as Record<string, unknown>;
  return sent['type'] === 'audio' ? undefined : sent;
};

const failureOf = (frame: Extract<Incoming, { type: 'error' }>): SpeechFailure =>
  new SpeechFailure({
    reason: frame.reason,
    message: frame.message,
    retryable: frame.reason === 'rate' || frame.reason === 'transport' || frame.reason === 'provider',
    retryAfterMs: frame.retryAfterMs,
  });

const decode = (message: Message): Result.Result<Incoming, SpeechFailure> =>
  typeof message === 'string'
    ? Result.try({
        try: () => JSON.parse(message) as Incoming,
        catch: () => SpeechFailure.provider('the scripted provider sent a frame that is not JSON', false),
      })
    : Result.fail(SpeechFailure.provider('the scripted provider sends text frames only', false));

type Listening = { readonly ready: boolean };

const quiet = (state: Listening, send: ReadonlyArray<Message> = []): Act<Listening> => ({ state, send, events: [] });

const jsonAudio = (pcm: Int16Array): string => JSON.stringify({ type: 'audio', pcm: [...pcm] });

const binaryAudio = (pcm: Int16Array): Uint8Array => new Uint8Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));

const listening = (request: RecognitionRequest, credential: Key, model: RecognitionModel, script: ScriptedProvider) => {
  const protocol: SpeechProtocol<Listening, Incoming> = {
    format: { rate: request.rate, channels: 1 },
    request: { url: `scripted://${model.id}`, headers: { authorization: credential.apiKey }, protocols: [] },
    init: [JSON.stringify({ type: 'init', model: model.id, turns: request.turns, rate: request.rate })],
    initial: { ready: false },
    decode,
    step: (state, frame) => {
      if (frame.type === 'ready') return Result.succeed(quiet({ ready: true }));
      if (frame.type === 'event') return Result.succeed({ state, send: [], events: [frame.event] });
      if (frame.type === 'error') return Result.fail(failureOf(frame));
      return Result.fail(SpeechFailure.provider(`a recognizer does not send ${frame.type}`, false));
    },
    ready: (state) => state.ready,
    audio: script.encoding === 'json' ? jsonAudio : binaryAudio,
    keepalive: script.keepalive,
    commit: (state, commit) => quiet(state, [JSON.stringify({ type: 'commit', commit })]),
    finalize: (state) => quiet(state, [JSON.stringify({ type: 'finalize' })]),
    finish: (state) => quiet(state, [JSON.stringify({ type: 'finish' })]),
  };
  return protocol;
};

type Speaking = { readonly ready: boolean };

const speaking = (request: SynthesisRequest, credential: Key, model: SynthesisModel) => {
  const protocol: SynthesisProtocol<Speaking, Incoming> = {
    format: { rate: request.rate, channels: 1 },
    request: { url: `scripted://${model.id}`, headers: { authorization: credential.apiKey }, protocols: [] },
    init: [JSON.stringify({ type: 'init', model: model.id, voice: request.voice })],
    initial: { ready: false },
    decode,
    step: (state, frame) => {
      const act = { state, send: [], audio: [], marks: [], done: false };
      if (frame.type === 'ready') return Result.succeed({ ...act, state: { ready: true } });
      if (frame.type === 'audio') {
        const pcm = Int16Array.from(frame.pcm);
        return Result.succeed({ ...act, audio: [new Uint8Array(pcm.buffer)] });
      }
      if (frame.type === 'bytes') return Result.succeed({ ...act, audio: [Uint8Array.from(frame.bytes)] });
      if (frame.type === 'marks')
        return Result.succeed({ ...act, marks: [{ text: frame.text, frames: { from: frame.from, to: frame.to } }] });
      if (frame.type === 'done') return Result.succeed({ ...act, done: true });
      if (frame.type === 'error') return Result.fail(failureOf(frame));
      return Result.fail(SpeechFailure.provider(`a synthesizer does not send ${frame.type}`, false));
    },
    ready: (state) => state.ready,
    say: (state, text) => ({ state, send: [JSON.stringify({ type: 'text', text })], audio: [], marks: [], done: false }),
    end: (state) => ({ state, send: [JSON.stringify({ type: 'end' })], audio: [], marks: [], done: false }),
  };
  return protocol;
};

export type ScriptedProvider = {
  readonly id: string;
  readonly recognition?: ReadonlyArray<RecognitionModel>;
  readonly synthesis?: ReadonlyArray<SynthesisModel>;
  readonly batch?: (clip: Clip, request: RecognitionRequest) => Stream.Stream<SpeechEvent, SpeechFailure>;
  readonly file?: (recorded: Recorded, request: RecognitionRequest) => Stream.Stream<FileEvent, SpeechFailure>;
  readonly resume?: (token: string) => Stream.Stream<FileEvent, SpeechFailure>;
  readonly discard?: (token: string) => Effect.Effect<void, SpeechFailure>;
  readonly availability?: (model: string) => Availability;
  readonly encoding?: 'binary' | 'json';
  readonly keepalive?: Keepalive;
};

export const scriptedProvider = (script: ScriptedProvider): SpeechProvider<Key, DuplexTransport> => {
  const { batch, file, resume, discard } = script;
  return {
    id: script.id,
    label: script.id,
    credential: { _tag: 'required', schema: Key },
    egress: [`scripted://${script.id}`],
    availability: (model) => Effect.succeed(script.availability?.(model) ?? { _tag: 'present' }),
    recognizer:
      script.recognition === undefined
        ? undefined
        : {
            models: script.recognition,
            stream: (model, request, credential) => duplex(listening(request, credential, model, script)),
            batch: batch === undefined ? undefined : (_model, clip, request) => batch(clip, request),
            file: file === undefined ? undefined : (_model, recorded, request) => file(recorded, request),
            resume: resume === undefined ? undefined : (_model, token) => resume(token),
            discard: discard === undefined ? undefined : (token) => discard(token),
          },
    synthesizer:
      script.synthesis === undefined
        ? undefined
        : {
            models: script.synthesis,
            open: (model, request, credential) => synthesisDuplex(speaking(request, credential, model)),
          },
  };
};
