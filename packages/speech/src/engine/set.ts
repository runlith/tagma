import type { Availability } from '@runlith/audio/port/devices';
import type { Format } from '@runlith/audio/sound/format';
import type { Track } from '@runlith/audio/sound/track';
import { type Context, Effect, type Scope, type Semaphore, type Stream } from 'effect';
import type { Recorded, Synthesis } from '../protocol/adapter.ts';
import type { RecognitionModel, SynthesisModel } from '../wire/capabilities.ts';
import type { SpeechFailure } from '../wire/failure.ts';
import type { Heard, Transcribed } from '../wire/heard.ts';
import type { RecognitionNeed, SynthesisNeed } from '../wire/requests.ts';
import { conditions } from './access.ts';
import type { Offer, SpeechCatalog, SpeechFault } from './catalog.ts';
import { chooseRecognition, chooseSynthesis, type NoModel, type RecognitionChoice, type SynthesisChoice } from './choose.ts';
import { recognition } from './recognition.ts';
import type { ListeningSettings } from './settings.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import { SpeechDetector } from './SpeechDetector.ts';
import { synthesis } from './synthesis.ts';
import { discarding, type TranscriptionOptions, transcription } from './transcription.ts';

export type RecognitionOptions = {
  readonly track: string;
  readonly origin: bigint;
  readonly account?: string | undefined;
  readonly settings?: ListeningSettings | undefined;
  readonly cut?: Effect.Effect<void> | undefined;
  readonly recorded?: boolean | undefined;
};

export type SynthesisOptions = {
  readonly account?: string | undefined;
  readonly rate?: number | undefined;
};

type ModelStatus = {
  readonly provider: string;
  readonly model: string;
  readonly kind: 'recognition' | 'synthesis';
  readonly availability: Availability;
};

type SpeechStatus = {
  readonly detector: Availability;
  readonly models: ReadonlyArray<ModelStatus>;
};

export type SpeechSet = {
  readonly recognition: ReadonlyArray<Offer<RecognitionModel>>;
  readonly synthesis: ReadonlyArray<Offer<SynthesisModel>>;
  readonly faults: ReadonlyArray<SpeechFault>;
  readonly keyed: ReadonlyArray<string>;
  readonly status: (account?: string) => Effect.Effect<SpeechStatus>;
  readonly recognizer: (need: RecognitionNeed, account?: string) => Effect.Effect<RecognitionChoice, NoModel>;
  readonly voice: (need: SynthesisNeed, account?: string) => Effect.Effect<SynthesisChoice, NoModel>;
  readonly recognize: (choice: RecognitionChoice, track: Track, options: RecognitionOptions) => Stream.Stream<Heard, SpeechFailure>;
  readonly transcribe: (
    choice: RecognitionChoice,
    recorded: Recorded,
    options: TranscriptionOptions,
  ) => Stream.Stream<Transcribed, SpeechFailure>;
  readonly resume: (
    choice: RecognitionChoice,
    token: string,
    format: Format,
    options: TranscriptionOptions,
  ) => Stream.Stream<Transcribed, SpeechFailure>;
  readonly discard: (provider: string, token: string, account?: string) => Effect.Effect<void, SpeechFailure>;
  readonly synthesize: (choice: SynthesisChoice, options: SynthesisOptions) => Effect.Effect<Synthesis, SpeechFailure, Scope.Scope>;
};

export const speechSet = <R>(input: {
  readonly catalog: SpeechCatalog<R>;
  readonly context: Context.Context<R | SpeechCredentials | SpeechDetector>;
  readonly streams: (provider: string, model: string) => Semaphore.Semaphore | undefined;
}): SpeechSet => {
  const { catalog, context, streams } = input;
  const judged = (account: string | undefined) =>
    Effect.provideContext(
      Effect.flatMap(
        SpeechDetector.use((detector) => detector.availability),
        (availability) => conditions(catalog, availability, account),
      ),
      context,
    );
  return {
    recognition: catalog.recognition,
    synthesis: catalog.synthesis,
    faults: catalog.faults,
    keyed: catalog.providers.filter((provider) => provider.credential._tag === 'required').map((provider) => provider.id),
    status: (account) =>
      Effect.map(judged(account), (known) => ({
        detector: known.detector,
        models: [
          ...catalog.recognition.map((offer) => ({
            provider: offer.provider,
            model: offer.model.id,
            kind: 'recognition' as const,
            availability: known.model(offer.provider, offer.model.id),
          })),
          ...catalog.synthesis.map((offer) => ({
            provider: offer.provider,
            model: offer.model.id,
            kind: 'synthesis' as const,
            availability: known.model(offer.provider, offer.model.id),
          })),
        ],
      })),
    recognizer: (need, account) => Effect.flatMap(judged(account), (known) => Effect.fromResult(chooseRecognition(catalog, need, known))),
    voice: (need, account) => Effect.flatMap(judged(account), (known) => Effect.fromResult(chooseSynthesis(catalog, need, known))),
    recognize: (choice, track, options) => recognition(catalog, context, choice, track, options),
    transcribe: (choice, recorded, options) => transcription(catalog, context, choice, { _tag: 'recorded', recorded }, options),
    resume: (choice, token, format, options) => transcription(catalog, context, choice, { _tag: 'job', token, format }, options),
    discard: (provider, token, account) => discarding(catalog, context, provider, token, account),
    synthesize: (choice, options) => synthesis(catalog, context, streams, choice, options),
  };
};
