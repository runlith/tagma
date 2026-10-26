import type { BatchRecognition, FileRecognition, RecognitionModel, StreamRecognition, SynthesisModel } from '../wire/capabilities.ts';

export const streaming = (id: string, capabilities: Partial<StreamRecognition> = {}): RecognitionModel => ({
  id,
  label: id,
  recognition: {
    kind: 'stream',
    rates: [16_000],
    partials: true,
    turns: ['provider', 'client'],
    finalize: true,
    timestamps: 'word',
    speakers: false,
    confidence: false,
    languages: { codes: ['en', 'ru'], hints: 2, detect: true },
    prompting: { prompt: false, terms: false },
    limits: {},
    tuning: [],
    ...capabilities,
  },
});

export const batching = (id: string, capabilities: Partial<BatchRecognition> = {}): RecognitionModel => ({
  id,
  label: id,
  recognition: {
    kind: 'batch',
    rates: [16_000],
    timestamps: 'segment',
    speakers: false,
    confidence: false,
    languages: { codes: [], hints: 1, detect: true },
    prompting: { prompt: true, terms: false },
    limits: { clipMs: 30_000 },
    tuning: [],
    ...capabilities,
  },
});

export const filing = (id: string, capabilities: Partial<FileRecognition> = {}): RecognitionModel => ({
  id,
  label: id,
  recognition: {
    kind: 'file',
    containers: ['audio/ogg', 'audio/wav'],
    timestamps: 'word',
    speakers: true,
    confidence: false,
    languages: { codes: [], hints: 2, detect: true },
    prompting: { prompt: false, terms: false },
    limits: {},
    ...capabilities,
  },
});

export const voiced = (id: string, text: 'stream' | 'whole'): SynthesisModel => ({
  id,
  label: id,
  synthesis: {
    text,
    rates: [24_000],
    voices: [{ id: 'calm', label: 'Calm', languages: ['en'] }],
    languages: ['en'],
    needsLanguage: false,
    timestamps: false,
    limits: { characters: 100 },
  },
});
