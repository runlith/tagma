import type { Format } from '@runlith/audio/sound/format';
import { type Context, Effect, Result, Stream } from 'effect';
import type { Recorded } from '../protocol/adapter.ts';
import type { FileRecognition, RecognitionModel } from '../wire/capabilities.ts';
import { type FileEvent, SpeechEvent } from '../wire/events.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { Heard, Transcribed } from '../wire/heard.ts';
import type { RecognitionRequest } from '../wire/requests.ts';
import { credentialOf, within } from './access.ts';
import type { AnyProvider } from '../protocol/adapter.ts';
import type { SpeechCatalog } from './catalog.ts';
import type { RecognitionChoice } from './choose.ts';
import { fitsRecognition } from './fits.ts';
import { listeningDefaults, type ListeningSettings } from './settings.ts';
import type { SpeechCredentials } from './SpeechCredentials.ts';
import { Assembler, type Splitting } from './turns.ts';

export type TranscriptionOptions = {
  readonly track: string;
  readonly account?: string | undefined;
  readonly settings?: ListeningSettings | undefined;
};

export type Source =
  | { readonly _tag: 'recorded'; readonly recorded: Recorded }
  | { readonly _tag: 'job'; readonly token: string; readonly format: Format };

type Found<R> = { readonly provider: AnyProvider<R>; readonly model: RecognitionModel<FileRecognition> };

const found = <R>(catalog: SpeechCatalog<R>, choice: RecognitionChoice): Result.Result<Found<R>, SpeechFailure> => {
  const provider = catalog.provider(choice.provider);
  const model = provider?.recognizer?.models.find((candidate) => candidate === choice.model);
  if (provider === undefined || model === undefined)
    return Result.fail(SpeechFailure.invalidRequest(`${choice.provider}/${choice.model.id} is not a recognizer of this catalog set`));
  const recognition = model.recognition;
  if (recognition.kind !== 'file')
    return Result.fail(SpeechFailure.unsupported(`${provider.id}/${model.id} hears a live track, not a recorded file`));
  return Result.succeed({ provider, model: { ...model, recognition } });
};

const refusedRecording = (model: RecognitionModel<FileRecognition>, recorded: Recorded): SpeechFailure | undefined => {
  const capabilities = model.recognition;
  if (!capabilities.containers.includes(recorded.mime))
    return SpeechFailure.unsupported(`${model.id} takes ${capabilities.containers.join(', ')}, not ${recorded.mime}`);
  const longest = capabilities.limits.fileMs;
  if (longest !== undefined && recorded.durationMs > longest)
    return SpeechFailure.invalidRequest(
      `${model.id} hears at most ${longest} ms in one file, and the recording runs ${recorded.durationMs} ms`,
    );
  return undefined;
};

const assembled = (
  events: Stream.Stream<FileEvent, SpeechFailure>,
  track: string,
  rate: number,
  splitting: Splitting,
): Stream.Stream<Transcribed, SpeechFailure> =>
  Stream.suspend(() => {
    const assembler = new Assembler(track, 1, 'none', { value: 0 }, splitting, {
      time: (frame) => (frame * 1000) / rate,
      commit: () => undefined,
    });
    let finished = false;
    const heard = (event: FileEvent): ReadonlyArray<Transcribed> => {
      if (finished) return [];
      if (event._tag === 'Job') return [event];
      if (event._tag !== 'Finished') return assembler.apply(event);
      finished = true;
      const last: ReadonlyArray<Heard> = assembler.closeAll();
      return [...last, SpeechEvent.finished];
    };
    return events.pipe(
      Stream.map(heard),
      Stream.flattenIterable,
      Stream.concat(
        Stream.suspend(() =>
          finished ? Stream.empty : Stream.fail(SpeechFailure.transport('the provider ended the transcription without Finished')),
        ),
      ),
    );
  });

export const transcription = <R>(
  catalog: SpeechCatalog<R>,
  context: Context.Context<R | SpeechCredentials>,
  choice: RecognitionChoice,
  source: Source,
  options: TranscriptionOptions,
): Stream.Stream<Transcribed, SpeechFailure> => {
  const located = found(catalog, choice);
  if (Result.isFailure(located)) return Stream.fail(located.failure);
  const { provider, model } = located.success;
  const recognizer = provider.recognizer;
  const capabilities = model.recognition;
  const wants = choice.wants;
  const fits = fitsRecognition(capabilities, 'none', wants);
  if (Result.isFailure(fits)) return Stream.fail(fits.failure);
  const credential = Effect.provideContext(credentialOf(provider, options.account), context);
  const splitting = (options.settings ?? listeningDefaults).splitting;
  if (source._tag === 'job') {
    const resume = recognizer?.resume;
    if (resume === undefined) return Stream.fail(SpeechFailure.unsupported(`${provider.id} keeps no work to resume`));
    const resumed = Stream.unwrap(Effect.map(credential, (key) => Stream.provideContext(resume(model, source.token, key), context)));
    return assembled(resumed, options.track, source.format.rate, splitting);
  }
  const recorded = source.recorded;
  const file = recognizer?.file;
  if (file === undefined) return Stream.fail(SpeechFailure.unsupported(`${provider.id}/${model.id} takes no file`));
  const refused = refusedRecording(model, recorded);
  if (refused !== undefined) return Stream.fail(refused);
  const request: RecognitionRequest = {
    turns: 'none',
    rate: recorded.format.rate,
    languages: wants.languages ?? [],
    detect: wants.detect ?? capabilities.languages.detect,
    speakers: wants.speakers ?? false,
    translation: wants.translation,
    prompt: wants.prompt,
    terms: wants.terms ?? [],
    tuning: {},
  };
  const heard = Stream.unwrap(Effect.map(credential, (key) => Stream.provideContext(file(model, recorded, request, key), context)));
  return assembled(heard, options.track, recorded.format.rate, splitting);
};

export const discarding = <R>(
  catalog: SpeechCatalog<R>,
  context: Context.Context<R | SpeechCredentials>,
  id: string,
  token: string,
  account: string | undefined,
): Effect.Effect<void, SpeechFailure> => {
  const provider = catalog.provider(id);
  if (provider === undefined) return Effect.fail(SpeechFailure.invalidRequest(`${id} is not a registered speech provider`));
  const discard = provider.recognizer?.discard;
  if (discard === undefined) return Effect.void;
  return Effect.scoped(
    within(
      Effect.flatMap(credentialOf(provider, account), (key) => discard(token, key)),
      context,
    ),
  );
};
