import { Schema } from 'effect';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { blockRef } from '../../../graph/contract/wire/fields.js';
import { LANGUAGE_TAG } from './language.js';
import { languageStandingSchema, projectionSchema } from './projection.js';
import { ASK_REFUSALS } from '../../../providers/contract/wire/asks.js';

const block = blockRef.annotate({ description: 'The block to translate.' });

const app = {
  approval: ASKS_NEVER,
  callers: 'operator',
  doors: { http: true },
  place: 'project',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;

export const TRANSLATION_OPERATIONS = {
  translate_block: operation('translate_block', {
    ...app,
    effect: 'external',
    identity: { key: 'call' },
    meaning:
      'Translate a block’s title and body into a language as a projection kept beside it, never changing the block: start the act for that block and language, or join the one running, and answer at once.',
    grammar:
      'Only parts with no translation of their current text are sent; `again` sends every part. `model` names a catalog model for this act, `reasoning` its rung; without them `translation.model` chooses, then the default text model. A projection that matches the block whole answers `current` with no model call.',
    input: Schema.Struct({
      block,
      language: LANGUAGE_TAG,
      model: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The catalog key of the model, as `provider:model`.',
      }),
      reasoning: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      again: Schema.optional(Schema.Boolean).annotate({ description: 'Translate every part again, the matching ones too.' }),
    }),
    answer: arms({
      current: { block: Schema.String, language: Schema.String },
      translating: {
        block: Schema.String,
        language: Schema.String,
        joined: Schema.Boolean.annotate({ description: 'An act already running for this block and language was joined.' }),
        model: Schema.String,
        rung: Schema.NullOr(Schema.String),
        sending: Schema.Int,
      },
    }),
    refusals: ASK_REFUSALS,
    subjects: () => [],
    confirmation: (input) => ({ summary: `Translate ${input.block} into ${input.language}?` }),
    confirmLabel: 'Translate',
    presentation: { running: 'Translating a block', done: 'Started translating a block' },
  }),
  read_block_translation: operation('read_block_translation', {
    ...app,
    effect: 'read',
    identity: 'none',
    meaning:
      'Read a block’s projection in a language against its current text: each part translated, changed since, or pending, with counts, and the block’s languages with their states.',
    grammar: 'Without `language`, only the languages and `preferred` answer.',
    input: Schema.Struct({ block, language: Schema.optional(LANGUAGE_TAG) }),
    answer: arms({
      read: {
        block: Schema.String,
        preferred: Schema.NullOr(Schema.String).annotate({
          description: '`translation.language`, else the last language translated into in this project; null leaves the system’s language.',
        }),
        languages: Schema.Array(languageStandingSchema),
        projection: Schema.NullOr(projectionSchema).annotate({ description: 'Null when no act ever ran in the language asked.' }),
      },
    }),
    refusals: [],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the translation of ${input.block}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading a translation', done: 'Read a translation' },
  }),
  stop_block_translation: operation('stop_block_translation', {
    ...app,
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'Stop the running translation of a block into a language; the batches it landed stay.',
    input: Schema.Struct({ block, language: LANGUAGE_TAG }),
    answer: arms({
      stopped: { block: Schema.String, language: Schema.String },
      idle: { block: Schema.String, language: Schema.String },
    }),
    refusals: [],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Stop translating ${input.block}?` }),
    confirmLabel: 'Stop',
    presentation: { running: 'Stopping a translation', done: 'Stopped a translation' },
  }),
};

export type TranslationOperationId = keyof typeof TRANSLATION_OPERATIONS;
