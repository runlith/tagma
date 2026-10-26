import type { Availability } from '@runlith/audio/port/devices';
import { Data, Result } from 'effect';
import type { RecognitionModel, SynthesisModel, TurnMode } from '../wire/capabilities.ts';
import type { RecognitionNeed, RecognitionWants, SynthesisNeed, SynthesisWants } from '../wire/requests.ts';
import type { Offer, SpeechCatalog } from './catalog.ts';
import { fitsRecognition, fitsSynthesis, speaks } from './fits.ts';

export type Rejection = {
  readonly provider: string;
  readonly model: string;
  readonly reason: string;
  readonly unblock: ReadonlyArray<string>;
};

export class NoModel extends Data.TaggedError('NoModel')<{
  readonly rejected: ReadonlyArray<Rejection>;
}> {}

export type RecognitionChoice = Offer<RecognitionModel> & { readonly turns: TurnMode; readonly wants: RecognitionWants };

export type SynthesisChoice = Offer<SynthesisModel> & { readonly voice: string; readonly wants: SynthesisWants };

export type Conditions = {
  readonly model: (provider: string, model: string) => Availability;
  readonly detector: Availability;
};

type Refusal = { readonly reason: string; readonly unblock: ReadonlyArray<string> };

const refusal = (reason: string, unblock: ReadonlyArray<string> = []): Refusal => ({ reason, unblock });

const named = (
  need: { readonly provider?: string | undefined; readonly model?: string | undefined },
  offer: Offer<{ readonly id: string }>,
) => (need.provider === undefined || need.provider === offer.provider) && (need.model === undefined || need.model === offer.model.id);

export const needsDetector = (model: RecognitionModel, turns: TurnMode): boolean => {
  const capabilities = model.recognition;
  if (capabilities.kind === 'file') return false;
  return capabilities.kind === 'batch' || turns === 'client' || (turns === 'none' && capabilities.timestamps !== 'word');
};

export const offeredTurns = (model: RecognitionModel): ReadonlyArray<TurnMode> => {
  const capabilities = model.recognition;
  if (capabilities.kind === 'batch') return ['client'];
  if (capabilities.kind === 'file') return ['none'];
  return capabilities.turns;
};

const modeOf = (offer: Offer<RecognitionModel>, need: RecognitionNeed, conditions: Conditions): Result.Result<TurnMode, Refusal> => {
  const capabilities = offer.model.recognition;
  const offered = offeredTurns(offer.model);
  const wanted = need.turns === undefined ? offered : [need.turns];
  const reasons: Array<Refusal> = [];
  for (const mode of wanted) {
    const fits = fitsRecognition(capabilities, mode, need);
    if (Result.isFailure(fits)) reasons.push(refusal(fits.failure.message));
    else if (needsDetector(offer.model, mode) && conditions.detector._tag === 'absent')
      reasons.push(refusal(`turn mode ${mode} needs the speech detector: ${conditions.detector.reason}`, conditions.detector.unblock));
    else return Result.succeed(mode);
  }
  const unique = (values: ReadonlyArray<string>) => [...new Set(values)];
  return Result.fail(
    refusal(unique(reasons.map((reason) => reason.reason)).join('; '), unique(reasons.flatMap((reason) => reason.unblock))),
  );
};

const judgeRecognition = (
  offer: Offer<RecognitionModel>,
  need: RecognitionNeed,
  conditions: Conditions,
): Result.Result<TurnMode, Refusal> => {
  if (!need.kinds.includes(offer.model.recognition.kind)) return Result.fail(refusal(`it is a ${offer.model.recognition.kind} model`));
  const mode = modeOf(offer, need, conditions);
  if (Result.isFailure(mode)) return mode;
  const availability = conditions.model(offer.provider, offer.model.id);
  if (availability._tag === 'absent') return Result.fail(refusal(availability.reason, availability.unblock));
  return mode;
};

const wantsOf = (need: RecognitionNeed): RecognitionWants => ({
  languages: need.languages,
  detect: need.detect,
  speakers: need.speakers,
  partials: need.partials,
  timestamps: need.timestamps,
  translation: need.translation,
  prompt: need.prompt,
  terms: need.terms,
  tuning: need.tuning,
});

export const chooseRecognition = <R>(
  catalog: SpeechCatalog<R>,
  need: RecognitionNeed,
  conditions: Conditions,
): Result.Result<RecognitionChoice, NoModel> => {
  const rejected: Array<Rejection> = [];
  const candidates = catalog.recognition.filter((offer) => named(need, offer));
  if (candidates.length === 0)
    rejected.push({
      provider: need.provider ?? '',
      model: need.model ?? '',
      reason: 'no such recognition model is registered',
      unblock: [],
    });
  for (const offer of candidates) {
    const judged = judgeRecognition(offer, need, conditions);
    if (Result.isSuccess(judged)) return Result.succeed({ ...offer, turns: judged.success, wants: wantsOf(need) });
    rejected.push({ provider: offer.provider, model: offer.model.id, ...judged.failure });
  }
  return Result.fail(new NoModel({ rejected }));
};

const voiceOf = (offer: Offer<SynthesisModel>, need: SynthesisNeed): string | undefined =>
  offer.model.synthesis.voices.find(
    (voice) =>
      (need.voice === undefined || voice.id === need.voice) && (need.language === undefined || speaks(voice.languages, need.language)),
  )?.id;

const judgeSynthesis = (offer: Offer<SynthesisModel>, need: SynthesisNeed, conditions: Conditions): Result.Result<string, Refusal> => {
  const voice = voiceOf(offer, need);
  if (voice === undefined)
    return Result.fail(refusal(need.voice === undefined ? 'no voice speaks that language' : `it has no voice ${need.voice}`));
  const fits = fitsSynthesis(offer.model.synthesis, voice, need);
  if (Result.isFailure(fits)) return Result.fail(refusal(fits.failure.message));
  const availability = conditions.model(offer.provider, offer.model.id);
  if (availability._tag === 'absent') return Result.fail(refusal(availability.reason, availability.unblock));
  return Result.succeed(voice);
};

export const chooseSynthesis = <R>(
  catalog: SpeechCatalog<R>,
  need: SynthesisNeed,
  conditions: Conditions,
): Result.Result<SynthesisChoice, NoModel> => {
  const rejected: Array<Rejection> = [];
  const candidates = catalog.synthesis.filter((offer) => named(need, offer));
  if (candidates.length === 0)
    rejected.push({ provider: need.provider ?? '', model: need.model ?? '', reason: 'no such synthesis model is registered', unblock: [] });
  for (const offer of candidates) {
    const judged = judgeSynthesis(offer, need, conditions);
    const wants: SynthesisWants = {
      voice: need.voice,
      language: need.language,
      timestamps: need.timestamps,
      instructions: need.instructions,
    };
    if (Result.isSuccess(judged)) return Result.succeed({ ...offer, voice: judged.success, wants });
    rejected.push({ provider: offer.provider, model: offer.model.id, ...judged.failure });
  }
  return Result.fail(new NoModel({ rejected }));
};
