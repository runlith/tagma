import { Result } from 'effect';
import type { RecognitionCapabilities, SynthesisCapabilities, TurnMode } from '../wire/capabilities.ts';
import { SpeechFailure } from '../wire/failure.ts';
import type { RecognitionWants, SynthesisWants } from '../wire/requests.ts';

export const speaks = (codes: ReadonlyArray<string>, language: string): boolean =>
  codes.length === 0 || codes.some((code) => code === language || code.split('-')[0] === language.split('-')[0]);

const RANK = { none: 0, segment: 1, word: 2 } as const;

const lacks = (message: string) => Result.fail(SpeechFailure.unsupported(message));
const refuses = (message: string) => Result.fail(SpeechFailure.invalidRequest(message));

const offers = (capabilities: RecognitionCapabilities, turns: TurnMode): boolean => {
  if (capabilities.kind === 'batch') return turns === 'client';
  if (capabilities.kind === 'file') return turns === 'none';
  return capabilities.turns.includes(turns);
};

const tuned = (capabilities: RecognitionCapabilities, turns: TurnMode, tuning: Readonly<Record<string, number>>) => {
  const knobs = capabilities.kind === 'file' ? [] : capabilities.tuning;
  for (const [id, value] of Object.entries(tuning)) {
    const knob = knobs.find((candidate) => candidate.id === id);
    if (knob === undefined) return refuses(`it has no tuning knob ${id}`);
    if (!(knob.min <= value && value <= knob.max)) return refuses(`tuning ${id} takes ${knob.min}..${knob.max}, not ${value}`);
    if (knob.modes.length > 0 && !knob.modes.includes(turns)) return refuses(`tuning ${id} does not apply in turn mode ${turns}`);
  }
  return Result.void;
};

export const fitsRecognition = (
  capabilities: RecognitionCapabilities,
  turns: TurnMode,
  wants: RecognitionWants,
): Result.Result<void, SpeechFailure> => {
  if (!offers(capabilities, turns)) return lacks(`turn mode ${turns} is not offered`);
  if (wants.partials === true && (capabilities.kind !== 'stream' || !capabilities.partials)) return lacks('it gives no partials');
  if (wants.speakers === true && !capabilities.speakers) return lacks('it does not tell speakers apart');
  if (wants.timestamps !== undefined && RANK[capabilities.timestamps] < RANK[wants.timestamps])
    return lacks(`it gives no ${wants.timestamps} timestamps`);
  const languages = wants.languages ?? [];
  const foreign = languages.find((language) => !speaks(capabilities.languages.codes, language));
  if (foreign !== undefined) return lacks(`it does not recognize ${foreign}`);
  if (languages.length > capabilities.languages.hints) return refuses(`it takes at most ${capabilities.languages.hints} language hints`);
  if (wants.detect === true && !capabilities.languages.detect) return lacks('it does not identify the language');
  const translation = wants.translation;
  if (translation !== undefined) {
    const offered = capabilities.translation;
    if (offered === undefined) return lacks('it does not translate');
    if (translation._tag === 'two-way' && !offered.twoWay) return lacks('it does not translate both ways');
    const targets = translation._tag === 'one-way' ? [translation.target] : [translation.a, translation.b];
    const missing = targets.find((target) => !speaks(offered.targets, target));
    if (missing !== undefined) return lacks(`it does not translate into ${missing}`);
  }
  if (wants.prompt !== undefined && !capabilities.prompting.prompt) return lacks('it takes no prompt');
  if ((wants.terms?.length ?? 0) > 0 && !capabilities.prompting.terms) return lacks('it takes no terms');
  return tuned(capabilities, turns, wants.tuning ?? {});
};

export const fitsSynthesis = (
  capabilities: SynthesisCapabilities,
  voice: string,
  wants: SynthesisWants,
): Result.Result<void, SpeechFailure> => {
  const known = capabilities.voices.find((candidate) => candidate.id === voice);
  if (known === undefined) return refuses(`it has no voice ${voice}`);
  if (capabilities.needsLanguage && wants.language === undefined) return refuses('it needs the language named in the request');
  if (wants.language !== undefined && !speaks(capabilities.languages, wants.language)) return lacks(`it does not speak ${wants.language}`);
  if (wants.language !== undefined && !speaks(known.languages, wants.language))
    return lacks(`voice ${voice} does not speak ${wants.language}`);
  if (wants.timestamps === true && !capabilities.timestamps) return lacks('it gives no timestamps');
  return Result.void;
};
