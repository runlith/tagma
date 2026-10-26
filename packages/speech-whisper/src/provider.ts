import type { BatchRecognition, RecognitionModel } from '@runlith/speech/wire/capabilities';
import { SpeechEvent, type Unit } from '@runlith/speech/wire/events';
import { SpeechFailure } from '@runlith/speech/wire/failure';
import type { RecognitionRequest } from '@runlith/speech/wire/requests';
import type { Clip, SpeechProvider } from '@runlith/speech/protocol/adapter';
import { Effect, Stream } from 'effect';
import type { Transcript } from './engine/clips.ts';
import { Engine } from './engine/Engine.ts';
import { speechFailure } from './failures.ts';
import { type ModelArtifact, models } from './models/catalog.ts';
import { ModelStore } from './models/ModelStore.ts';

const rate = 16_000;

const languages =
  'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su yue'.split(
    ' ',
  );

const recognition: BatchRecognition = {
  kind: 'batch',
  rates: [rate],
  timestamps: 'segment',
  speakers: false,
  confidence: false,
  languages: { codes: languages, hints: 1, detect: true },
  prompting: { prompt: false, terms: false },
  limits: { clipMs: 30_000 },
  tuning: [],
};

const recognitionModels = (artifacts: ReadonlyArray<ModelArtifact>): ReadonlyArray<RecognitionModel> =>
  artifacts.map((artifact) => ({ id: artifact.id, label: artifact.label, recognition }));

const languageOf = (request: RecognitionRequest): string | undefined => request.languages[0];

const events = (transcript: Transcript, clip: Clip, turn: string, hint: string | undefined): ReadonlyArray<SpeechEvent> => {
  const end = clip.pcm.length;
  const frames = (ms: number) => Math.min(end, Math.max(0, Math.round((ms * rate) / 1000)));
  const units: ReadonlyArray<Unit> = transcript.segments
    .filter((segment) => segment.text.trim() !== '')
    .map((segment) => ({
      lane: 'source',
      text: segment.text,
      granularity: 'segment',
      time: { from: frames(segment.from), to: frames(segment.to) },
      language: hint ?? transcript.language ?? undefined,
    }));
  return units.length === 0 ? [SpeechEvent.finished] : [SpeechEvent.final(turn, units), SpeechEvent.turnEnd(turn), SpeechEvent.finished];
};

export const whisperProvider: Effect.Effect<SpeechProvider<undefined>, never, Engine | ModelStore> = Effect.gen(function* () {
  const engine = yield* Engine;
  const store = yield* ModelStore;
  let clips = 0;
  return {
    id: 'whisper',
    label: 'Whisper',
    credential: { _tag: 'none', value: undefined },
    egress: [],
    availability: (model: string) =>
      Effect.match(store.installed(model), {
        onSuccess: () => ({ _tag: 'present' as const }),
        onFailure: (failure) => ({ _tag: 'absent' as const, reason: failure.message, unblock: [`install the Whisper model ${model}`] }),
      }),
    recognizer: {
      models: recognitionModels(store.artifacts),
      batch: (model, clip, request) =>
        Stream.unwrap(
          Effect.gen(function* () {
            if (clip.format.rate !== rate || clip.format.channels !== 1) {
              return yield* SpeechFailure.invalidRequest(`Whisper takes mono audio at ${rate} Hz`);
            }
            const installed = yield* Effect.mapError(store.installed(model.id), speechFailure);
            const hint = languageOf(request);
            const transcript = yield* Effect.mapError(engine.transcribe(installed, clip.pcm, hint), speechFailure);
            clips += 1;
            return Stream.fromIterable(events(transcript, clip, String(clips), hint));
          }),
        ),
    },
  };
});

export const unbuiltProvider = (reason: string): SpeechProvider<undefined> => ({
  id: 'whisper',
  label: 'Whisper',
  credential: { _tag: 'none', value: undefined },
  egress: [],
  availability: () => Effect.succeed({ _tag: 'absent', reason, unblock: [] }),
  recognizer: {
    models: recognitionModels(models),
    batch: () => Stream.fail(SpeechFailure.unsupported(reason)),
  },
});
