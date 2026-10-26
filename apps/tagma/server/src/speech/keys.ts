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

export const dictationKey = settingKey({
  id: 'speech.dictation.key',
  order: 902,
  title: 'Dictation key',
  description:
    'The chord held in the Tagma window to dictate into the focused agent field or terminal, written as modifiers and a key code joined by `+`, like `Alt+Space`; a tap shorter than 300 ms keeps recording until the next press.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  fallback: 'Alt+Space',
  scopes: ['user'],
  merge: 'replace',
});

export const globalDictation = settingKey({
  id: 'speech.dictation.global',
  order: 903,
  title: 'Global dictation',
  description:
    'Whether the Tagma desktop app dictates into whatever app is focused while its global key is held; it needs Accessibility for Tagma in macOS Privacy & Security.',
  schema: Schema.Boolean,
  fallback: false,
  scopes: ['user'],
  merge: 'replace',
});

export const globalDictationKey = settingKey({
  id: 'speech.dictation.globalKey',
  order: 904,
  title: 'Global dictation key',
  description:
    'The chord held in any app to dictate into it, written like the dictation key; the Tagma window keeps its own key while it is focused.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  fallback: 'Alt+Space',
  scopes: ['user'],
  merge: 'replace',
});

export const callTracks = settingKey({
  id: 'speech.calls.tracks',
  order: 905,
  title: 'Call recording',
  description:
    'What Record call captures: `both` is the microphone (you) and system audio (everyone else in the call); `mic` is the microphone alone, for a meeting in one room. Speaker echo cancellation is controlled separately by `speech.calls.echo`.',
  schema: Schema.Literals(['both', 'mic']),
  fallback: 'both',
  scopes: ['user'],
  merge: 'replace',
});

export const callSpeakers = settingKey({
  id: 'speech.calls.speakers',
  order: 906,
  title: 'Separate speakers in calls',
  description:
    'Whether a recorded call numbers the people on the other side when its recognizer can tell speakers apart; a recognizer that cannot records the call without numbers.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: ['user'],
  merge: 'replace',
});

export const callKeys = settingKey({
  id: 'speech.calls.keys',
  order: 907,
  title: 'Call keys',
  description:
    'The chords the Tagma window answers while a call records, written like the dictation key: `mark` sets a mark at this moment, `mute` mutes or unmutes the microphone.',
  schema: Schema.Struct({
    mark: Schema.String.check(Schema.isMinLength(1)),
    mute: Schema.String.check(Schema.isMinLength(1)),
  }),
  fallback: { mark: 'Control+Alt+KeyM', mute: 'Control+Alt+KeyA' },
  scopes: ['user'],
  merge: 'replace',
});

export const callFollowEvery = settingKey({
  id: 'speech.calls.followEvery',
  order: 909,
  title: 'Agent beside a call',
  description:
    'How many minutes apart an agent following a call receives what was newly said; it also receives a piece at each mark you set and when the call ends.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60 })),
  fallback: 3,
  scopes: ['user'],
  merge: 'replace',
});

export const callAudio = settingKey({
  id: 'speech.calls.audio',
  order: 908,
  title: 'Call audio',
  description:
    'Whether a new call records its sound for the player and for recognizing it again (`record`), and how many days from its start the sound of every call is kept (`days`; empty keeps it for good). A shorter term erases older sound at the next hourly pass; the transcript stays.',
  schema: Schema.Struct({ record: Schema.Boolean, days: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))) }),
  fallback: { record: true, days: 30 },
  scopes: ['user'],
  merge: 'replace',
});

export const callAgain = settingKey({
  id: 'speech.calls.again',
  order: 911,
  title: 'Recognize calls again with',
  description:
    'The provider and model Recognize again uses for the recorded sound of an ended call when it names none: a model that hears a whole file, or a local model faster than real time. Empty takes the first available file model that tells speakers apart.',
  schema: Schema.Struct({ provider: Schema.optional(Schema.String), model: Schema.optional(Schema.String) }),
  fallback: {},
  scopes: ['user'],
  merge: 'replace',
});

export const callEcho = settingKey({
  id: 'speech.calls.echo',
  order: 912,
  title: 'Cancel speaker echo in calls',
  description:
    'Whether a new call that records system audio takes out of the microphone what plays from the speakers, so the other side is not heard twice as you. It applies only when sound goes to the speakers, never to headphones, and may soften your words spoken over theirs.',
  schema: Schema.Boolean,
  fallback: false,
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

export const SPEECH_SETTINGS = [
  recognizerChoice,
  dictationRecognizer,
  dictationKey,
  globalDictation,
  globalDictationKey,
  callTracks,
  callSpeakers,
  callKeys,
  callAudio,
  callAgain,
  callFollowEvery,
  callEcho,
  languages,
  voiceChoice,
  microphone,
  tuning,
  segmenter,
] as const;

export const SPEECH_SETTING_SECTIONS = [
  {
    id: 'speech',
    order: 140,
    title: 'Speech',
    description: 'How the machine running this server listens and speaks: the recognizer, the voice, the microphone and where turns end.',
  },
] as const;
