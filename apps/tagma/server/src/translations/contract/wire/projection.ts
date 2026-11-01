import { Schema } from 'effect';
import { BlockIdentity } from '../../../graph/contract/wire/references.js';

export const ACT_STATES = ['translating', 'done', 'failed', 'stopped'] as const;
export type ActState = (typeof ACT_STATES)[number];

export const PART_STATES = ['translated', 'changed', 'pending', 'kept'] as const;
export type PartState = (typeof PART_STATES)[number];

export const PART_KINDS = ['title', 'text', 'kept'] as const;

export const projectedPartSchema = Schema.Struct({
  kind: Schema.Literals(PART_KINDS).annotate({
    description: '`title`, a top-level markdown block (`text`), or a block never sent (`kept`: code, HTML, a rule).',
  }),
  source: Schema.String.annotate({ description: 'The part as the block says it now.' }),
  state: Schema.Literals(PART_STATES).annotate({
    description:
      '`translated`: `text` matches the current source; `changed`: no translation of the current source stands and no act sends it; `pending`: the running act sends it; `kept`: never sent, shown as written.',
  }),
  text: Schema.NullOr(Schema.String).annotate({ description: 'The translation of the current source; null unless translated.' }),
});
export type ProjectedPart = typeof projectedPartSchema.Type;

export const partCountsFields = {
  translated: Schema.Int,
  changed: Schema.Int,
  pending: Schema.Int,
  total: Schema.Int.annotate({ description: 'Parts a model translates: the title and every block not kept.' }),
};

export const languageStandingSchema = Schema.Struct({
  language: Schema.String,
  state: Schema.Literals(ACT_STATES),
  ...partCountsFields,
});
export type LanguageStanding = typeof languageStandingSchema.Type;

export const projectionSchema = Schema.Struct({
  language: Schema.String,
  state: Schema.Literals(ACT_STATES).annotate({ description: 'The state of the last act in this language.' }),
  model: Schema.String.annotate({ description: 'The catalog key of the model the last act chose.' }),
  rung: Schema.NullOr(Schema.String),
  at: Schema.String.annotate({ description: 'When the last act began, ISO.' }),
  reason: Schema.NullOr(Schema.String).annotate({ description: 'Why a batch of a failed act failed.' }),
  failed: Schema.Int.annotate({ description: 'Parts the failed batches of the last act left untranslated.' }),
  ...partCountsFields,
  parts: Schema.Array(projectedPartSchema).annotate({ description: 'The title first, then the body’s top-level blocks in order.' }),
  titles: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })).annotate({
    description: 'The translated titles in this language of the blocks the body names by a bare `[[name]]`, where one stands.',
  }),
});
export type Projection = typeof projectionSchema.Type;

export const translationFrameSchema = Schema.Struct({
  block: Schema.String.annotate({ description: 'The name of the block translated.' }),
  identity: BlockIdentity,
  language: Schema.String,
  state: Schema.Literals(ACT_STATES),
  landed: Schema.Int.annotate({ description: 'Parts this act has landed so far.' }),
  sending: Schema.Int.annotate({ description: 'Parts this act sends.' }),
});
export type TranslationFrame = typeof translationFrameSchema.Type;
