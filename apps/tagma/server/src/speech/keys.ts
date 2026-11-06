import { Schema } from 'effect';
import { settingKey } from '../platform/contract/wire/setting.js';
import { TurnMode } from './contract/wire/listening.js';

const RecognizerPick = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  turns: Schema.optional(TurnMode),
});
export type RecognizerPick = typeof RecognizerPick.Type;

export const recognizerChoice = settingKey({
  id: 'speech.recognizer',
  order: 900,
  title: 'Default recognizer',
  description:
    'The provider, model and turn mode a listening or a check run recognizes with when it names none; what is left out is chosen by capability.',
  schema: RecognizerPick,
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const dictationRecognizer = settingKey({
  id: 'speech.dictation.recognizer',
  order: 901,
  title: 'Dictation recognizer',
  description: 'The provider, model and turn mode dictation recognizes with; empty takes the default recognizer.',
  schema: RecognizerPick,
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const languages = settingKey({
  id: 'speech.languages',
  order: 905,
  title: 'Spoken languages',
  description: 'Language codes recognition is hinted with, first the likeliest; empty lets the recognizer detect the language.',
  schema: Schema.Array(Schema.String),
  fallback: [],
  scopes: ['user'],
  merge: 'replace',
});

export const voiceChoice = settingKey({
  id: 'speech.voice',
  order: 910,
  title: 'Default voice',
  description: 'The provider, model, voice and language speech is synthesized with when a request names none.',
  schema: Schema.Struct({
    provider: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    voice: Schema.optional(Schema.String),
    language: Schema.optional(Schema.String),
  }),
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const microphone = settingKey({
  id: 'speech.microphone',
  order: 915,
  title: 'Microphone',
  description:
    'The id of the input device of the machine running this server that a microphone track captures when it names none; empty takes the system default.',
  schema: Schema.NullOr(Schema.String),
  fallback: null,
  scopes: ['user'],
  merge: 'replace',
});

export const tuning = settingKey({
  id: 'speech.tuning',
  order: 920,
  title: 'Recognizer tuning',
  description: 'The tuning numbers a recognition model declares, keyed by provider/model, each within the range the model gives.',
  schema: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)),
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const segmenter = settingKey({
  id: 'speech.segmenter',
  order: 925,
  title: 'Speech boundaries',
  description:
    'Where the speech detector cuts turns: start and end probabilities, the shortest speech and silence, the pre-roll and the longest turn, in milliseconds; what is left out keeps its measured default.',
  schema: Schema.Struct({
    start: Schema.optional(Schema.Number),
    end: Schema.optional(Schema.Number),
    minSpeechMs: Schema.optional(Schema.Number),
    minSilenceMs: Schema.optional(Schema.Number),
    preRollMs: Schema.optional(Schema.Number),
    maxMs: Schema.optional(Schema.Number),
  }),
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const SPEECH_SETTINGS = [recognizerChoice, dictationRecognizer, languages, voiceChoice, microphone, tuning, segmenter] as const;

export const SPEECH_SETTING_SECTIONS = [
  {
    id: 'speech',
    order: 140,
    title: 'Speech',
    description: 'How the machine running this server listens and speaks: the recognizer, the voice, the microphone and where turns end.',
  },
] as const;
