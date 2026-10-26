import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';

export type Place = {
  readonly catalog: SettingsCatalog;
  readonly scope: SettableScope;
  readonly project: Project | null;
  readonly reload: () => Promise<unknown>;
};

export type TurnMode = 'provider' | 'client' | 'none';

export type RecognizerChoice = { readonly provider?: string; readonly model?: string; readonly turns?: TurnMode };

export type VoiceChoice = {
  readonly provider?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly language?: string;
};

export type Tuning = Readonly<Record<string, Readonly<Record<string, number>>>>;

export const SPEECH = {
  recognizer: 'speech.recognizer',
  dictationRecognizer: 'speech.dictation.recognizer',
  dictationKey: 'speech.dictation.key',
  globalDictation: 'speech.dictation.global',
  globalKey: 'speech.dictation.globalKey',
  callTracks: 'speech.calls.tracks',
  callSpeakers: 'speech.calls.speakers',
  callKeys: 'speech.calls.keys',
  callAudio: 'speech.calls.audio',
  callAgain: 'speech.calls.again',
  languages: 'speech.languages',
  voice: 'speech.voice',
  microphone: 'speech.microphone',
  tuning: 'speech.tuning',
  segmenter: 'speech.segmenter',
} as const;

export function stood<T>(catalog: SettingsCatalog, id: string): T | undefined {
  const entry = catalog.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return undefined;
  const answer = catalog.answerOf(entry, 'user');
  return (answer.own ?? answer.inherited) as T;
}

const SELECTING: readonly string[] = [SPEECH.recognizer, SPEECH.dictationRecognizer, SPEECH.languages, SPEECH.tuning];

export async function keep(place: Place, id: string, value: unknown): Promise<void> {
  await place.catalog.write({ scope: 'user', key: id, value });
  if (SELECTING.includes(id) && place.catalog.outcomes[id]?.kind === 'saved') await place.reload();
}

export const modelKey = (provider: string, model: string): string => `${provider}/${model}`;

const TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

export const languageName = (code: string): string =>
  TAG.test(code) ? (new Intl.DisplayNames(undefined, { type: 'language', fallback: 'code' }).of(code) ?? code) : code;
