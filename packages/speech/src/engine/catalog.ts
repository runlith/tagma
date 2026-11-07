import { Predicate, Result, Schema } from 'effect';
import type { AnyProvider } from '../protocol/adapter.ts';
import {
  type Knob,
  type LiveRecognition,
  type RecognitionCapabilities,
  RecognitionModel,
  SynthesisModel,
  type TurnMode,
} from '../wire/capabilities.ts';

export type Offer<Model> = {
  readonly provider: string;
  readonly model: Model;
};

export const live = (offer: Offer<RecognitionModel>): offer is Offer<RecognitionModel<LiveRecognition>> =>
  offer.model.recognition.kind !== 'file';

export type SpeechPart<R> =
  | { readonly owner: string; readonly revision?: string | undefined; readonly providers: ReadonlyArray<AnyProvider<R>> }
  | { readonly owner: string; readonly revision?: string | undefined; readonly failure: string };

export type SpeechFault = {
  readonly owner: string;
  readonly provider?: string | undefined;
  readonly reason: string;
};

export type SpeechCatalog<R> = {
  readonly providers: ReadonlyArray<AnyProvider<R>>;
  readonly owners: ReadonlyMap<string, string>;
  readonly recognition: ReadonlyArray<Offer<RecognitionModel>>;
  readonly synthesis: ReadonlyArray<Offer<SynthesisModel>>;
  readonly faults: ReadonlyArray<SpeechFault>;
  readonly provider: (id: string) => AnyProvider<R> | undefined;
};

const unique = (ids: ReadonlyArray<string>, what: string) => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === '') throw new Error(`${what} has an empty id.`);
    if (seen.has(id)) throw new Error(`${what} "${id}" is declared twice.`);
    seen.add(id);
  }
};

const rates = (values: ReadonlyArray<number>, where: string) => {
  if (values.length === 0) throw new Error(`${where} declares no sample rate.`);
  for (const rate of values) if (!Number.isInteger(rate) || rate <= 0) throw new Error(`${where} declares rate ${rate}.`);
};

const knobs = (tuning: ReadonlyArray<Knob>, turns: ReadonlyArray<TurnMode>, where: string) => {
  unique(
    tuning.map((knob) => knob.id),
    `${where} tuning knob`,
  );
  for (const knob of tuning) {
    if (!(knob.min <= knob.initial && knob.initial <= knob.max))
      throw new Error(`${where} tuning knob "${knob.id}" starts outside ${knob.min}..${knob.max}.`);
    for (const mode of knob.modes)
      if (!turns.includes(mode)) throw new Error(`${where} tuning knob "${knob.id}" names undeclared turn mode ${mode}.`);
  }
};

const recognitionConsistent = (capabilities: RecognitionCapabilities, where: string) => {
  if (!Number.isInteger(capabilities.languages.hints) || capabilities.languages.hints < 0)
    throw new Error(`${where} declares ${capabilities.languages.hints} language hints.`);
  if (capabilities.translation !== undefined && capabilities.translation.targets.length === 0)
    throw new Error(`${where} translates into no language.`);
  if (capabilities.kind === 'file') {
    if (capabilities.containers.length === 0) throw new Error(`${where} takes no file container.`);
    return;
  }
  rates(capabilities.rates, where);
  if (capabilities.kind === 'batch') {
    knobs(capabilities.tuning, ['client'], where);
    return;
  }
  if (capabilities.turns.length === 0) throw new Error(`${where} supports no turn mode.`);
  unique(capabilities.turns, `${where} turn mode`);
  if (capabilities.turns.includes('none') && capabilities.timestamps !== 'word' && !capabilities.finalize)
    throw new Error(`${where} offers turn mode none without word timestamps or finalize: the core could never close its utterances.`);
  knobs(capabilities.tuning, capabilities.turns, where);
};

const recognitionShape = Schema.decodeUnknownResult(RecognitionModel);

const synthesisShape = Schema.decodeUnknownResult(SynthesisModel);

const declared = (entry: unknown): void => {
  if (!Predicate.isObject(entry)) throw new Error('A speech list entry is not a speech provider.');
  const { id, label, egress, credential, availability, recognizer, synthesizer } = entry;
  if (typeof id !== 'string' || id === '') throw new Error('Speech provider has an empty id.');
  if (typeof label !== 'string') throw new Error(`Speech provider "${id}" has no label.`);
  if (!Array.isArray(egress) || !egress.every((host) => typeof host === 'string'))
    throw new Error(`Speech provider "${id}" declares egress that is not a list of hosts.`);
  if (!Predicate.isObject(credential) || (credential['_tag'] !== 'none' && credential['_tag'] !== 'required'))
    throw new Error(`Speech provider "${id}" declares no credential form.`);
  if (credential['_tag'] === 'required' && !Schema.isSchema(credential['schema']))
    throw new Error(`Speech provider "${id}" requires a credential without a schema.`);
  if (typeof availability !== 'function') throw new Error(`Speech provider "${id}" declares no availability.`);
  const side = (
    what: string,
    declaredSide: unknown,
    shape: (entry: unknown) => Result.Result<unknown, { readonly message: string }>,
    calls: ReadonlyArray<string>,
    required: ReadonlyArray<string>,
  ) => {
    if (declaredSide === undefined) return;
    if (!Predicate.isObject(declaredSide) || !Array.isArray(declaredSide['models']))
      throw new Error(`Speech provider "${id}" declares a ${what} without a list of models.`);
    for (const entry of declaredSide['models']) {
      const shaped = shape(entry);
      if (Result.isFailure(shaped))
        throw new Error(`Speech provider "${id}" declares a ${what} model that is malformed: ${shaped.failure.message}`);
    }
    for (const call of calls) {
      const value = declaredSide[call];
      if ((value !== undefined || required.includes(call)) && typeof value !== 'function')
        throw new Error(`Speech provider "${id}" declares a ${what} whose ${call} is not a function.`);
    }
  };
  side('recognizer', recognizer, recognitionShape, ['stream', 'batch', 'file', 'resume', 'discard'], []);
  side('synthesizer', synthesizer, synthesisShape, ['open'], ['open']);
};

const providerConsistent = <R>(provider: AnyProvider<R>) => {
  const recognizer = provider.recognizer;
  const synthesizer = provider.synthesizer;
  if (recognizer === undefined && synthesizer === undefined)
    throw new Error(`Speech provider "${provider.id}" neither recognizes nor synthesizes.`);
  if (recognizer !== undefined) {
    if (recognizer.models.length === 0) throw new Error(`Speech provider "${provider.id}" recognizes with no model.`);
    unique(
      recognizer.models.map((model) => model.id),
      `${provider.id} recognition model`,
    );
    for (const model of recognizer.models) {
      const where = `${provider.id}/${model.id}`;
      recognitionConsistent(model.recognition, where);
      if (model.recognition.kind === 'stream' && recognizer.stream === undefined)
        throw new Error(`${where} is a stream model but the recognizer does not stream.`);
      if (model.recognition.kind === 'batch' && recognizer.batch === undefined)
        throw new Error(`${where} is a batch model but the recognizer takes no clip.`);
      if (model.recognition.kind === 'file' && recognizer.file === undefined)
        throw new Error(`${where} is a file model but the recognizer takes no file.`);
    }
    if ((recognizer.resume === undefined) !== (recognizer.discard === undefined))
      throw new Error(`Speech provider "${provider.id}" resumes work it cannot discard, or discards work it cannot resume.`);
  }
  if (synthesizer !== undefined) {
    if (synthesizer.models.length === 0) throw new Error(`Speech provider "${provider.id}" synthesizes with no model.`);
    unique(
      synthesizer.models.map((model) => model.id),
      `${provider.id} synthesis model`,
    );
    for (const model of synthesizer.models) {
      const where = `${provider.id}/${model.id}`;
      rates(model.synthesis.rates, where);
      if (model.synthesis.voices.length === 0) throw new Error(`${where} offers no voice.`);
      unique(
        model.synthesis.voices.map((voice) => voice.id),
        `${where} voice`,
      );
      if (model.synthesis.needsLanguage && model.synthesis.languages.length === 0)
        throw new Error(`${where} needs a language but names none.`);
    }
  }
};

const idOf = (entry: unknown): string | undefined =>
  Predicate.isObject(entry) && typeof entry['id'] === 'string' && entry['id'] !== '' ? entry['id'] : undefined;

const refusalOf = <R>(
  provider: AnyProvider<R>,
  owner: string,
  holders: ReadonlyMap<string, string>,
  taken: ReadonlyMap<string, string>,
): string | undefined => {
  try {
    declared(provider);
    const holder = holders.get(provider.id);
    if (holder !== undefined) return `Speech provider "${provider.id}" is already declared by ${holder}.`;
    const other = taken.get(provider.id);
    if (other !== undefined && other !== owner) return `"${provider.id}" is already a provider of ${other}.`;
    providerConsistent(provider);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

export const speechCatalog = <R>(parts: ReadonlyArray<SpeechPart<R>>, taken: ReadonlyMap<string, string> = new Map()): SpeechCatalog<R> => {
  const holders = new Map<string, string>();
  const providers: Array<AnyProvider<R>> = [];
  const faults: Array<SpeechFault> = [];
  for (const part of parts) {
    if ('failure' in part) {
      faults.push({ owner: part.owner, reason: part.failure });
      continue;
    }
    for (const provider of part.providers) {
      const reason = refusalOf(provider, part.owner, holders, taken);
      if (reason !== undefined) {
        faults.push({ owner: part.owner, provider: idOf(provider), reason });
        continue;
      }
      holders.set(provider.id, part.owner);
      providers.push(provider);
    }
  }
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    providers,
    owners: holders,
    recognition: providers.flatMap((provider) => (provider.recognizer?.models ?? []).map((model) => ({ provider: provider.id, model }))),
    synthesis: providers.flatMap((provider) => (provider.synthesizer?.models ?? []).map((model) => ({ provider: provider.id, model }))),
    faults,
    provider: (id) => byId.get(id),
  };
};
