import { Availability, Capabilities, Device, Permissions } from '@runlith/audio/port/devices';
import { Schema } from 'effect';
import { TrackPlace, TurnMode } from './listening.js';

export const Knob = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  min: Schema.Number,
  max: Schema.Number,
  initial: Schema.Number,
  modes: Schema.Array(TurnMode),
});

export const Voice = Schema.Struct({ id: Schema.String, label: Schema.String, languages: Schema.Array(Schema.String) });

export const ModelStatus = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(['recognition', 'file', 'synthesis']).annotate({
    description: '`recognition` hears live sound, `file` only a recorded file, `synthesis` speaks.',
  }),
  recorded: Schema.Boolean.annotate({
    description: 'Whether it hears a recorded file: a file model, or a batch model faster than real time.',
  }),
  again: Schema.Boolean.annotate({ description: 'The same answer as `recorded`, kept for clients of earlier releases.' }),
  speakers: Schema.Boolean,
  availability: Availability,
  turns: Schema.Array(TurnMode),
  languages: Schema.Array(Schema.String),
  tuning: Schema.Array(Knob),
  voices: Schema.Array(Voice),
});
export type ModelStatus = typeof ModelStatus.Type;

export const LocalModelStatus = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  size: Schema.Number,
  installed: Schema.Boolean,
  partial: Schema.Number,
  received: Schema.NullOr(Schema.Number),
  failure: Schema.NullOr(Schema.String),
});

export const DevicesStatus = Schema.Struct({
  capabilities: Capabilities,
  availability: Availability,
  inputs: Schema.Array(Device),
  permissions: Schema.NullOr(Permissions),
  refusal: Schema.NullOr(Schema.String),
  said: Schema.NullOr(Schema.String).annotate({ description: 'What is wrong with the sound of this machine, in the words of a person.' }),
});

export type DevicesStatus = typeof DevicesStatus.Type;

export const DictationReadiness = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('ready'), provider: Schema.String, model: Schema.String, label: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('blocked'), reason: Schema.String, unblock: Schema.Array(Schema.String), said: Schema.String }),
]);
export type DictationReadiness = typeof DictationReadiness.Type;

export const SpeechStatus = Schema.Struct({
  devices: DevicesStatus,
  detector: Availability,
  models: Schema.Array(ModelStatus),
  dictation: DictationReadiness,
  mic: TrackPlace,
  local: Schema.Array(LocalModelStatus),
});
export type SpeechStatus = typeof SpeechStatus.Type;
