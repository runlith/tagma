import { Format } from '@runlith/audio/sound/format';
import { Schema } from 'effect';

export const SpeakAsk = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1)),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
});
export type SpeakAsk = typeof SpeakAsk.Type;

export const Voiced = Schema.Struct({ provider: Schema.String, model: Schema.String, voice: Schema.String });
export type Voiced = typeof Voiced.Type;

export const Synthesized = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('voice'), ...Voiced.fields, format: Format }),
  Schema.Struct({ kind: Schema.Literal('audio'), pcm: Schema.Uint8Array }),
]);
export type Synthesized = typeof Synthesized.Type;
