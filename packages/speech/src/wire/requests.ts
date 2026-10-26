import type { RecognitionKind, TurnMode } from './capabilities.ts';

export type TranslationRequest =
  | { readonly _tag: 'one-way'; readonly target: string }
  | { readonly _tag: 'two-way'; readonly a: string; readonly b: string };

export type RecognitionRequest = {
  readonly turns: TurnMode;
  readonly rate: number;
  readonly languages: ReadonlyArray<string>;
  readonly detect: boolean;
  readonly speakers: boolean;
  readonly translation?: TranslationRequest | undefined;
  readonly prompt?: string | undefined;
  readonly terms: ReadonlyArray<string>;
  readonly tuning: Readonly<Record<string, number>>;
};

export type SynthesisRequest = {
  readonly voice: string;
  readonly rate: number;
  readonly language?: string | undefined;
  readonly timestamps: boolean;
  readonly instructions?: string | undefined;
};

export type RecognitionWants = {
  readonly languages?: ReadonlyArray<string> | undefined;
  readonly detect?: boolean | undefined;
  readonly speakers?: boolean | undefined;
  readonly partials?: boolean | undefined;
  readonly timestamps?: 'word' | 'segment' | undefined;
  readonly translation?: TranslationRequest | undefined;
  readonly prompt?: string | undefined;
  readonly terms?: ReadonlyArray<string> | undefined;
  readonly tuning?: Readonly<Record<string, number>> | undefined;
};

export type RecognitionNeed = RecognitionWants & {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly kinds: ReadonlyArray<RecognitionKind>;
  readonly turns?: TurnMode | undefined;
};

export type SynthesisWants = {
  readonly voice?: string | undefined;
  readonly language?: string | undefined;
  readonly timestamps?: boolean | undefined;
  readonly instructions?: string | undefined;
};

export type SynthesisNeed = SynthesisWants & {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
};
