import type { Knob, RecognitionModel, SynthesisModel, Voice } from '@runlith/speech/wire/capabilities';

export const RATE = 24_000;

const SESSION_MS = 60 * 60_000;

export const languages: ReadonlyArray<string> = [
  'af',
  'ar',
  'hy',
  'az',
  'be',
  'bs',
  'bg',
  'ca',
  'zh',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'gl',
  'de',
  'el',
  'he',
  'hi',
  'hu',
  'is',
  'id',
  'it',
  'ja',
  'kn',
  'kk',
  'ko',
  'lv',
  'lt',
  'mk',
  'ms',
  'mr',
  'mi',
  'ne',
  'no',
  'fa',
  'pl',
  'pt',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'sw',
  'sv',
  'tl',
  'ta',
  'th',
  'tr',
  'uk',
  'ur',
  'vi',
  'cy',
];

export const detection: ReadonlyArray<Knob> = [
  { id: 'threshold', label: 'Speech threshold', min: 0, max: 1, initial: 0.5, modes: ['provider'] },
  { id: 'silence_duration_ms', label: 'Silence before the end (ms)', min: 200, max: 3000, initial: 500, modes: ['provider'] },
];

const base = {
  rates: [RATE],
  timestamps: 'none' as const,
  speakers: false,
  confidence: false,
  limits: { sessionMs: SESSION_MS },
};

export const LIVE = 'gpt-live-transcribe';

const live: RecognitionModel = {
  id: LIVE,
  label: 'GPT Live Transcribe',
  recognition: {
    ...base,
    kind: 'stream',
    partials: true,
    turns: ['client'],
    finalize: false,
    languages: { codes: languages, hints: 8, detect: false },
    prompting: { prompt: true, terms: true },
    tuning: [],
  },
};

const turned = (id: string, label: string): RecognitionModel => ({
  id,
  label,
  recognition: {
    ...base,
    kind: 'stream',
    partials: true,
    turns: ['provider', 'client'],
    finalize: false,
    languages: { codes: languages, hints: 1, detect: false },
    prompting: { prompt: true, terms: false },
    tuning: detection,
  },
});

export const recognitionModels: ReadonlyArray<RecognitionModel> = [
  live,
  turned('gpt-4o-transcribe', 'GPT-4o Transcribe'),
  turned('gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe'),
];

const voice = (id: string): Voice => ({ id, label: id, languages });

const classic: ReadonlyArray<Voice> = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map(voice);

const instructed: ReadonlyArray<Voice> = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
].map(voice);

const speaking = (id: string, label: string, voices: ReadonlyArray<Voice>): SynthesisModel => ({
  id,
  label,
  synthesis: {
    text: 'whole',
    rates: [RATE],
    voices,
    languages,
    timestamps: false,
    needsLanguage: false,
    limits: { characters: 4096 },
  },
});

export const INSTRUCTED = 'gpt-4o-mini-tts';

export const synthesisModels: ReadonlyArray<SynthesisModel> = [
  speaking(INSTRUCTED, 'GPT-4o mini TTS', instructed),
  speaking('tts-1', 'TTS 1', classic),
  speaking('tts-1-hd', 'TTS 1 HD', classic),
];
