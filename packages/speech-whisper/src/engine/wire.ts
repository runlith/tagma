import { Schema } from 'effect';

export const Ready = Schema.Struct({
  type: Schema.Literal('ready'),
  pid: Schema.Int,
  rate: Schema.Int,
  window: Schema.Int,
});
export type Ready = typeof Ready.Type;

export const Segment = Schema.Struct({ from: Schema.Finite, to: Schema.Finite, text: Schema.String });
export type Segment = typeof Segment.Type;

const Result = Schema.Struct({
  type: Schema.Literal('result'),
  id: Schema.String,
  language: Schema.NullOr(Schema.String),
  segments: Schema.Array(Segment),
});

const Answer = Schema.Struct({
  type: Schema.Literals(['loaded', 'unloaded', 'cancelled']),
  id: Schema.String,
});

const Probs = Schema.Struct({
  type: Schema.Literal('vad.probs'),
  stream: Schema.String,
  at: Schema.Int,
  samples: Schema.Int,
  probs: Schema.Array(Schema.Finite),
});

const StreamAnswer = Schema.Struct({
  type: Schema.Literals(['vad.opened', 'vad.ended']),
  id: Schema.String,
  stream: Schema.String,
});

const Refusal = Schema.Struct({
  type: Schema.Literal('error'),
  id: Schema.optional(Schema.String),
  stream: Schema.optional(Schema.String),
  code: Schema.String,
  message: Schema.String,
});

export const Message = Schema.Union([Ready, Result, Answer, Probs, StreamAnswer, Refusal]);
export type Message = typeof Message.Type;
export type Refusal = typeof Refusal.Type;

export const decodeLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Message), { onExcessProperty: 'error' });

export type Command =
  | { readonly type: 'load'; readonly id: string; readonly path: string }
  | { readonly type: 'unload'; readonly id: string }
  | { readonly type: 'transcribe'; readonly id: string; readonly language?: string }
  | { readonly type: 'cancel'; readonly id: string }
  | { readonly type: 'vad.open' | 'vad.end'; readonly id: string; readonly stream: string }
  | { readonly type: 'vad.audio' | 'vad.reset' | 'vad.close'; readonly stream: string }
  | { readonly type: 'quit' };

const encoder = new TextEncoder();

export const frame = (command: Command, pcm?: Int16Array): Uint8Array => {
  const header = encoder.encode(JSON.stringify(command));
  const payload = pcm === undefined ? 0 : pcm.byteLength;
  const whole = new Uint8Array(8 + header.byteLength + payload);
  const view = new DataView(whole.buffer);
  view.setUint32(0, header.byteLength);
  view.setUint32(4, payload);
  whole.set(header, 8);
  if (pcm !== undefined) whole.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 8 + header.byteLength);
  return whole;
};
