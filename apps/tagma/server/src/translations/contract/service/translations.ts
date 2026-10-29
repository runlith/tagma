import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { LanguageStanding, Projection, TranslationFrame } from '../wire/projection.js';

export type Translated = {
  readonly projectId: number;
  readonly uuid: string;
  readonly name: string;
  readonly title: string;
  readonly body: string;
};

export type ReferencedTitle = { readonly name: string; readonly projectId: number; readonly uuid: string; readonly title: string };

export type TranslationAsk = {
  readonly language: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly again: boolean;
};

export type TranslationStart =
  | { readonly status: 'current' }
  | {
      readonly status: 'translating';
      readonly joined: boolean;
      readonly model: string;
      readonly rung: string | null;
      readonly sending: number;
    };

export type TranslationReading = {
  readonly preferred: string | null;
  readonly languages: readonly LanguageStanding[];
  readonly projection: Projection | null;
};

export type StartRefusal = GateRefusal<'translation-model-missing' | 'invalid-selection' | 'project-retired'>;

export class Translations extends Context.Service<
  Translations,
  {
    start(block: Translated, ask: TranslationAsk): Effect.Effect<TranslationStart, StartRefusal | StoreFailure>;
    read(
      block: Translated,
      language: string | undefined,
      references: readonly ReferencedTitle[],
    ): Effect.Effect<TranslationReading, StoreFailure>;
    stop(block: Translated, language: string): Effect.Effect<boolean>;
    readonly changes: (projectId: number) => Stream.Stream<TranslationFrame>;
  }
>()('translations/Translations') {}
