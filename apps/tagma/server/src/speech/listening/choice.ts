import type { NoModel, RecognitionChoice } from '@runlith/speech/engine/choose';
import { speaks } from '@runlith/speech/engine/fits';
import { type ListeningSettings, listeningDefaults } from '@runlith/speech/engine/settings';
import type { SpeechSet } from '@runlith/speech/engine/set';
import { LIVE, RECORDED } from '@runlith/speech/wire/capabilities';
import type { RecognitionNeed } from '@runlith/speech/wire/requests';
import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { SettingKey } from '../../platform/contract/wire/setting.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { DictationReadiness } from '../contract/wire/status.js';
import type { ModelAsk, Recognizer, RecognizerAsk } from '../contract/wire/listening.js';
import { NO_MODEL_WORDS } from '../contract/wire/words.js';
import { dictationRecognizer, languages, type RecognizerPick, recognizerChoice, segmenter, tuning } from '../keys.js';

export type Chosen = { readonly choice: RecognitionChoice; readonly recognizer: Recognizer };

export const noModel = (missing: NoModel): GateRefusal<'no-model'> => {
  const reasons = missing.rejected.map((rejected) =>
    rejected.provider === '' ? rejected.reason : `${rejected.provider}/${rejected.model}: ${rejected.reason}`,
  );
  const unblock = [...new Set(missing.rejected.flatMap((rejected) => rejected.unblock))];
  const ways: readonly [string, ...string[]] =
    unblock.length > 0 ? [unblock[0]!, ...unblock.slice(1)] : ['choose another provider or model in Settings → Speech'];
  return new GateRefusal('no-model', `no model can do this: ${reasons.join('; ')}`, ways).saying(NO_MODEL_WORDS);
};

const needOf = (recognizer: Recognizer): RecognitionNeed => ({
  kinds: LIVE,
  provider: recognizer.provider,
  model: recognizer.model,
  turns: recognizer.turns,
  languages: recognizer.languages.length === 0 ? undefined : recognizer.languages,
  speakers: recognizer.speakers ? true : undefined,
  tuning: Object.keys(recognizer.tuning).length === 0 ? undefined : recognizer.tuning,
});

export const again = (speech: SpeechSet, recognizer: Recognizer): Effect.Effect<RecognitionChoice, GateRefusal<'no-model'>> =>
  Effect.mapError(speech.recognizer(needOf(recognizer), recognizer.account), noModel);

const standingOf = Effect.fn('Speech.standingOf')(function* (
  settings: Settings['Service'],
  preferred: SettingKey<RecognizerPick> | undefined,
): Effect.fn.Return<RecognizerPick, StoreFailure> {
  if (preferred !== undefined) {
    const own = yield* settings.value(preferred);
    if (own.provider !== undefined || own.model !== undefined || own.turns !== undefined) return own;
  }
  return yield* settings.value(recognizerChoice);
});

export const chosen = Effect.fn('Speech.chosen')(function* (
  speech: SpeechSet,
  settings: Settings['Service'],
  ask: RecognizerAsk | undefined,
  preferred?: SettingKey<RecognizerPick>,
): Effect.fn.Return<Chosen, GateRefusal<'no-model'> | StoreFailure> {
  const standing = yield* standingOf(settings, preferred);
  const spoken = ask?.languages ?? (yield* settings.value(languages));
  const named = ask?.provider === undefined && ask?.model === undefined;
  const need: RecognitionNeed = {
    kinds: LIVE,
    provider: ask?.provider ?? (named ? standing.provider : undefined),
    model: ask?.model ?? (named ? standing.model : undefined),
    turns: ask?.turns ?? (named ? standing.turns : undefined),
    languages: spoken.length === 0 ? undefined : spoken,
  };
  const first = yield* (
    ask?.speakers === 'prefer'
      ? speech
          .recognizer({ ...need, speakers: true }, ask.account)
          .pipe(Effect.catchTag('NoModel', () => speech.recognizer(need, ask.account)))
      : speech.recognizer(ask?.speakers === true ? { ...need, speakers: true } : need, ask?.account)
  ).pipe(Effect.mapError(noModel));
  const speakers = ask?.speakers === true || (ask?.speakers === 'prefer' && first.wants.speakers === true);
  const knobs = (yield* settings.value(tuning))[`${first.provider}/${first.model.id}`] ?? {};
  const recognizer: Recognizer = {
    provider: first.provider,
    model: first.model.id,
    turns: first.turns,
    languages: [...spoken],
    speakers,
    tuning: knobs,
    account: ask?.account,
  };
  if (Object.keys(knobs).length === 0) return { choice: first, recognizer };
  return { choice: yield* again(speech, recognizer), recognizer };
});

type ModelPick = { readonly provider?: string | undefined; readonly model?: string | undefined };

export const recordedChoice = Effect.fn('Speech.recordedChoice')(function* (
  speech: SpeechSet,
  ask: ModelAsk | undefined,
  standing: ModelPick,
  spoken: readonly string[],
): Effect.fn.Return<RecognitionChoice, GateRefusal<'no-model'>> {
  const named = ask?.provider !== undefined || ask?.model !== undefined;
  const need: RecognitionNeed = {
    kinds: RECORDED,
    provider: ask?.provider ?? (named ? undefined : standing.provider),
    model: ask?.model ?? (named ? undefined : standing.model),
  };
  const open = need.provider === undefined && need.model === undefined;
  const first = yield* (
    open
      ? speech
          .recognizer({ ...need, kinds: ['file'], speakers: true }, ask?.account)
          .pipe(Effect.catchTag('NoModel', () => speech.recognizer(need, ask?.account)))
      : speech.recognizer(need, ask?.account)
  ).pipe(Effect.mapError(noModel));
  const capabilities = first.model.recognition;
  const hinted = spoken.filter((language) => speaks(capabilities.languages.codes, language)).slice(0, capabilities.languages.hints);
  const exact: RecognitionNeed = {
    kinds: RECORDED,
    provider: first.provider,
    model: first.model.id,
    languages: hinted.length === 0 ? undefined : hinted,
    speakers: capabilities.speakers ? true : undefined,
  };
  return yield* Effect.mapError(speech.recognizer(exact, ask?.account), noModel);
});

export const dictationReadiness = Effect.fn('Speech.dictationReadiness')(function* (
  speech: SpeechSet,
  settings: Settings['Service'],
): Effect.fn.Return<DictationReadiness, StoreFailure> {
  return yield* chosen(speech, settings, undefined, dictationRecognizer).pipe(
    Effect.map(({ choice }): DictationReadiness => ({
      kind: 'ready',
      provider: choice.provider,
      model: choice.model.id,
      label: choice.model.label,
    })),
    Effect.catchTag('GateRefusal', (refused) =>
      Effect.succeed<DictationReadiness>({
        kind: 'blocked',
        reason: refused.reason,
        unblock: [...refused.unblock],
        said: refused.words?.text ?? NO_MODEL_WORDS.text,
      }),
    ),
  );
});

export const listeningSettings = (settings: Settings['Service']): Effect.Effect<ListeningSettings, StoreFailure> =>
  Effect.map(settings.value(segmenter), (bounds) => ({
    ...listeningDefaults,
    segmenter: { ...listeningDefaults.segmenter, ...bounds },
  }));
