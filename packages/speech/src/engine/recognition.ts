import type { Track } from '@runlith/audio/sound/track';
import { type Context, Effect, Result, type Scope, Stream } from 'effect';
import { DuplexLimits } from '../protocol/duplex.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Heard } from '../wire/heard.ts';
import type { RecognitionRequest } from '../wire/requests.ts';
import { credentialOf, rateFor, within } from './access.ts';
import type { SpeechCatalog } from './catalog.ts';
import { needsDetector, type RecognitionChoice } from './choose.ts';
import { clips } from './clips.ts';
import { fitsRecognition } from './fits.ts';
import { listen } from './listen.ts';
import { listeningDefaults } from './settings.ts';
import type { RecognitionOptions } from './set.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import { type Detection, SpeechDetector } from './SpeechDetector.ts';

export const recognition = <R>(
  catalog: SpeechCatalog<R>,
  context: Context.Context<R | SpeechCredentials | SpeechDetector>,
  choice: RecognitionChoice,
  track: Track,
  options: RecognitionOptions,
): Stream.Stream<Heard, SpeechFailure> => {
  const provider = catalog.provider(choice.provider);
  const recognizer = provider?.recognizer;
  const model = recognizer?.models.find((candidate) => candidate === choice.model);
  if (provider === undefined || recognizer === undefined || model === undefined)
    return Stream.fail(SpeechFailure.invalidRequest(`${choice.provider}/${choice.model.id} is not a recognizer of this catalog set`));
  if (track.format.channels !== 1) return Stream.fail(SpeechFailure.invalidRequest('recognition takes mono audio'));
  const capabilities = model.recognition;
  if (capabilities.kind === 'file')
    return Stream.fail(SpeechFailure.unsupported(`${provider.id}/${model.id} hears a recorded file, not a live track`));
  const wants = choice.wants;
  const fits = fitsRecognition(capabilities, choice.turns, wants);
  if (Result.isFailure(fits)) return Stream.fail(fits.failure);
  const settings = options.settings ?? listeningDefaults;
  const rate = rateFor(capabilities.rates, track.format.rate);
  const request: RecognitionRequest = {
    turns: choice.turns,
    rate,
    languages: wants.languages ?? [],
    detect: wants.detect ?? capabilities.languages.detect,
    speakers: wants.speakers ?? false,
    translation: wants.translation,
    prompt: wants.prompt,
    terms: wants.terms ?? [],
    tuning: wants.tuning ?? {},
  };
  const detector: Effect.Effect<Detection, SpeechFailure, Scope.Scope> = within(
    SpeechDetector.use((service) => service.open),
    context,
  );
  const credential = Effect.provideContext(credentialOf(provider, options.account), context);
  if (capabilities.kind === 'batch') {
    const batch = recognizer.batch;
    if (batch === undefined) return Stream.fail(SpeechFailure.unsupported(`${provider.id}/${model.id} takes no clip`));
    return clips(
      { track: options.track, origin: options.origin, rate, settings, limits: capabilities.limits, recorded: options.recorded === true },
      track,
      detector,
      (clip) => Stream.unwrap(Effect.map(credential, (key) => Stream.provideContext(batch(model, clip, request, key), context))),
      options.cut,
    );
  }
  const stream = recognizer.stream;
  if (stream === undefined) return Stream.fail(SpeechFailure.unsupported(`${provider.id}/${model.id} does not stream`));
  const connect = within(
    Effect.flatMap(credential, (key) => stream(model, request, key)).pipe(
      Effect.provideService(DuplexLimits, { budgetMs: settings.budgetMs, readyMs: settings.readyMs }),
    ),
    context,
  );
  const detecting = needsDetector(model, choice.turns);
  return listen(
    { track: options.track, origin: options.origin, mode: choice.turns, capabilities, settings },
    connect,
    track,
    detecting ? detector : undefined,
    options.cut,
  );
};
