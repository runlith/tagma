import { Schema } from 'effect';

export const TurnMode = Schema.Literals(['provider', 'client', 'none']);
export type TurnMode = typeof TurnMode.Type;

export const Timestamps = Schema.Literals(['word', 'segment', 'none']);
export type Timestamps = typeof Timestamps.Type;

export const Languages = Schema.Struct({
  codes: Schema.Array(Schema.String),
  hints: Schema.Number,
  detect: Schema.Boolean,
});
export type Languages = typeof Languages.Type;

export const Translation = Schema.Struct({
  targets: Schema.Array(Schema.String),
  twoWay: Schema.Boolean,
});
export type Translation = typeof Translation.Type;

export const Prompting = Schema.Struct({
  prompt: Schema.Boolean,
  terms: Schema.Boolean,
});
export type Prompting = typeof Prompting.Type;

export const Limits = Schema.Struct({
  sessionMs: Schema.optional(Schema.Number),
  clipMs: Schema.optional(Schema.Number),
  clipBytes: Schema.optional(Schema.Number),
});
export type Limits = typeof Limits.Type;

export const Knob = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  min: Schema.Number,
  max: Schema.Number,
  initial: Schema.Number,
  modes: Schema.Array(TurnMode),
});
export type Knob = typeof Knob.Type;

const recognizing = {
  timestamps: Timestamps,
  speakers: Schema.Boolean,
  confidence: Schema.Boolean,
  languages: Languages,
  translation: Schema.optional(Translation),
  prompting: Prompting,
};

const sampled = {
  ...recognizing,
  rates: Schema.Array(Schema.Number),
  limits: Limits,
  tuning: Schema.Array(Knob),
};

export const StreamRecognition = Schema.Struct({
  ...sampled,
  kind: Schema.Literal('stream'),
  partials: Schema.Boolean,
  turns: Schema.Array(TurnMode),
  finalize: Schema.Boolean,
});
export type StreamRecognition = typeof StreamRecognition.Type;

export const BatchRecognition = Schema.Struct({
  ...sampled,
  kind: Schema.Literal('batch'),
});
export type BatchRecognition = typeof BatchRecognition.Type;

export const FileLimits = Schema.Struct({
  fileMs: Schema.optional(Schema.Number),
});
export type FileLimits = typeof FileLimits.Type;

export const FileRecognition = Schema.Struct({
  ...recognizing,
  kind: Schema.Literal('file'),
  containers: Schema.Array(Schema.String),
  limits: FileLimits,
});
export type FileRecognition = typeof FileRecognition.Type;

export type LiveRecognition = StreamRecognition | BatchRecognition;

export const RecognitionCapabilities = Schema.Union([StreamRecognition, BatchRecognition, FileRecognition]);
export type RecognitionCapabilities = typeof RecognitionCapabilities.Type;

export type RecognitionKind = RecognitionCapabilities['kind'];

export const LIVE: ReadonlyArray<RecognitionKind> = ['stream', 'batch'];

export const RECORDED: ReadonlyArray<RecognitionKind> = ['file', 'batch'];

export const Voice = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  languages: Schema.Array(Schema.String),
});
export type Voice = typeof Voice.Type;

export const SynthesisLimits = Schema.Struct({
  characters: Schema.optional(Schema.Number),
  audioMs: Schema.optional(Schema.Number),
  streams: Schema.optional(Schema.Number),
});
export type SynthesisLimits = typeof SynthesisLimits.Type;

export const SynthesisCapabilities = Schema.Struct({
  text: Schema.Literals(['stream', 'whole']),
  rates: Schema.Array(Schema.Number),
  voices: Schema.Array(Voice),
  languages: Schema.Array(Schema.String),
  needsLanguage: Schema.Boolean,
  timestamps: Schema.Boolean,
  limits: SynthesisLimits,
});
export type SynthesisCapabilities = typeof SynthesisCapabilities.Type;

export const RecognitionModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  recognition: RecognitionCapabilities,
});
export type RecognitionModel<Capabilities extends RecognitionCapabilities = RecognitionCapabilities> = {
  readonly id: string;
  readonly label: string;
  readonly recognition: Capabilities;
};

export const SynthesisModel = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  synthesis: SynthesisCapabilities,
});
export type SynthesisModel = typeof SynthesisModel.Type;
