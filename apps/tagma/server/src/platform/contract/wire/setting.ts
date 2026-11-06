import type { AskKind } from '@runlith/llm/models/description';
import { Schema } from 'effect';
import type { SessionRef } from './session.js';
import type { StartMoves } from './start.js';

export const SETTING_SCOPES = ['default', 'user', 'project'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export const SETTABLE_SCOPES = ['user', 'project'] as const;
export type SettableScope = (typeof SETTABLE_SCOPES)[number];

export const SETTING_MERGES = ['replace', 'concat', 'union'] as const;
export type SettingMerge = (typeof SETTING_MERGES)[number];

export const SETTING_UNITS = [
  'characters',
  'bytes',
  'seconds',
  'minutes',
  'milliseconds',
  'microseconds',
  'hours',
  'days',
  'traces',
  'pings',
  'tokens',
] as const;
export type SettingUnit = (typeof SETTING_UNITS)[number];

export type SettingSectionDeclaration = {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
};

export type SettingChoice = { readonly value: string; readonly label: string; readonly hint: string };

export type SettingColorSlot = { readonly key: string; readonly label: string; readonly hint?: string };

export type SettingColorGroup = { readonly label: string; readonly slots: readonly SettingColorSlot[] };

export const AskChoice = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoning: Schema.optional(Schema.NullOr(Schema.String)),
});
export type AskChoice = typeof AskChoice.Type;

export type AskControl = { readonly kind: 'ask'; readonly of: AskKind };

export type SettingFieldCondition = { readonly path: readonly string[]; readonly equals: string };

export type SettingField =
  | { readonly kind: 'model'; readonly path: readonly [string, string]; readonly label: string }
  | (AskControl & { readonly label: string })
  | {
      readonly kind: 'share';
      readonly path: readonly [string];
      readonly label: string;
      readonly minimum: number;
      readonly maximum: number;
      readonly reference?: { readonly ceiling: number; readonly of: string };
      readonly when?: SettingFieldCondition;
    }
  | {
      readonly kind: 'choice';
      readonly path: readonly [string];
      readonly label: string;
      readonly choices: readonly SettingChoice[];
    }
  | { readonly kind: 'text'; readonly path: readonly [string]; readonly label: string; readonly placeholder?: string };

export type SettingControl =
  | { readonly kind: 'choice'; readonly choices: readonly SettingChoice[]; readonly multiple?: true }
  | { readonly kind: 'slider'; readonly minimum: number; readonly maximum: number; readonly step: number }
  | {
      readonly kind: 'share';
      readonly minimum: number;
      readonly maximum: number;
      readonly reference?: { readonly ceiling: number; readonly of: string };
    }
  | {
      readonly kind: 'number';
      readonly minimum: number;
      readonly maximum?: number;
      readonly step: number;
      readonly unit: SettingUnit;
    }
  | { readonly kind: 'catalog'; readonly of: string }
  | AskControl
  | { readonly kind: 'colors'; readonly groups: readonly SettingColorGroup[] }
  | { readonly kind: 'machine' }
  | { readonly kind: 'rows'; readonly fields: readonly SettingField[]; readonly merging?: true }
  | { readonly kind: 'managed'; readonly by: string };

export type SettingControlReader = () => SettingControl;

export type SettingLayerAnswerOf<A> = {
  readonly value?: A;
  readonly declined: boolean;
  readonly writer?: SessionRef;
};

export type SettingLayersOf<A> = Partial<Record<SettableScope, SettingLayerAnswerOf<A>>>;

export type SettingLayerAnswer = SettingLayerAnswerOf<unknown>;
export type SettingLayers = SettingLayersOf<unknown>;

export type SettingDeclaration<A> = {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly schema: Schema.Codec<A, unknown>;
  readonly control?: SettingControl;
  readonly fallback: A;
  readonly scopes: readonly SettableScope[];
  readonly merge: SettingMerge;
  readonly member?: Schema.Codec<unknown, unknown>;
  readonly installs?: true;
  readonly operatorOnly?: true;
  readonly shapesStart?: StartMoves;
};

export type SettingKey<A, Section extends string = string> = SettingDeclaration<A> & { readonly section: Section };

export type SettingId<Section extends string = string> = `${Section}.${string}`;

type SectionOf<Id extends string> = Id extends `${infer Section}.${string}` ? Section : never;

export type SettingValue<K> = K extends SettingKey<infer A, string> ? A : never;

const sectionOf = <const Id extends SettingId>(id: Id): SectionOf<Id> => id.slice(0, id.indexOf('.')) as SectionOf<Id>;

export function settingKey<A, const Id extends SettingId>(
  declaration: SettingDeclaration<A> & { readonly id: Id },
): SettingKey<A, SectionOf<Id>> & { readonly id: Id } {
  return { ...declaration, section: sectionOf(declaration.id) };
}

export function settingListKey<M, const Id extends SettingId>(
  declaration: Omit<SettingDeclaration<readonly M[]>, 'schema' | 'member'> & {
    readonly id: Id;
    readonly member: Schema.Codec<M, unknown>;
  },
): SettingKey<readonly M[], SectionOf<Id>> & { readonly id: Id } {
  return {
    ...declaration,
    section: sectionOf(declaration.id),
    schema: Schema.Array(declaration.member),
    member: declaration.member as Schema.Codec<unknown, unknown>,
  };
}
