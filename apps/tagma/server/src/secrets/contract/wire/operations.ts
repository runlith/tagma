import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import {
  SECRET_CHANGE_REFUSALS,
  SECRET_READ_REFUSALS,
  SECRET_REMOVE_REFUSALS,
  SECRET_VALUE_MAX,
  secretNameSchema,
  secretOwnerIdSchema,
  secretOwnerSchema,
  secretRowSchema,
  secretSetSchema,
} from './rows.js';

const operatorOnly = { doors: { http: true }, callers: 'operator', subject: 'none', place: 'home', waits: [], lifetimes: [] } as const;

export const SECRET_ROWS = {
  ...family('secrets', 1, 'json', { text: 3_500, json: 3_500 }, 20, () => ({
    owner: 'x'.repeat(32),
    id: 'x'.repeat(80),
    title: 'x'.repeat(80),
    secrets: Array.from({ length: 8 }, () => ({ name: 'X'.repeat(64), description: 'x'.repeat(300), set: false })),
    missing: 8,
  })),
};

const named = { owner: secretOwnerSchema, id: secretOwnerIdSchema, name: secretNameSchema };

const answered = arms({ ok: { owner: Schema.String, id: Schema.String, secret: secretRowSchema } });

export const SECRET_OPERATIONS = {
  read_secrets: operation('read_secrets', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        sets: Schema.Array(secretSetSchema),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
      },
    }),
    meaning:
      'Read the secrets each owner of one kind declares in this project, with whether the operator has given each a value and how many are still missing.',
    grammar:
      'A page of owners by id, with the total; `id` narrows it to one owner, and `next` continues the walk, null on the last page. The values are never answered.',
    input: Schema.Struct({
      owner: secretOwnerSchema,
      id: Schema.optional(secretOwnerIdSchema),
      limit: limitOf(SECRET_ROWS),
      cursor: PAGE_CURSOR,
    }),
    refusals: [...SECRET_READ_REFUSALS, 'bad-cursor', 'cursor-stale'],
    page: SECRET_ROWS,
    confirmation: (input) => ({ summary: `Read which secrets of ${input.owner} have a value?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the secrets', done: 'Read the secrets' },
    subjects: () => [],
  }),
  set_secret: operation('set_secret', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    answer: answered,
    meaning:
      'Give a secret its owner declares a value: what reads it — a process or a connection — starts again once with it, and what it answers is masked where it carries the value.',
    grammar: `Only a secret the owner declares is set. The value is kept on this machine and never read back; an empty value, or one over ${SECRET_VALUE_MAX} characters or holding a NUL, refuses. Answers once what reads it has started again.`,
    input: Schema.Struct({ ...named, value: Schema.String }),
    refusals: SECRET_CHANGE_REFUSALS,
    confirmation: (input) => ({
      summary: `Give ${input.name} of ${input.owner} ${input.id} a value?`,
      consequence: 'What reads it starts again with it.',
    }),
    confirmLabel: 'Set secret',
    presentation: { running: 'Setting a secret', done: 'Set a secret' },
    subjects: () => [],
  }),
  remove_secret: operation('remove_secret', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    intent: 'destructive',
    destructiveConsequence: (input) => `The value of ${input.name} for ${input.owner} ${input.id} is removed from this machine.`,
    answer: answered,
    meaning: 'Remove the value of a secret: what reads it starts again once without it.',
    input: Schema.Struct(named),
    refusals: SECRET_REMOVE_REFUSALS,
    confirmation: (input) => ({
      summary: `Remove ${input.name} of ${input.owner} ${input.id}?`,
      consequence: 'What reads it starts again without it.',
    }),
    confirmLabel: 'Remove secret',
    presentation: { running: 'Removing a secret', done: 'Removed a secret' },
    subjects: () => [],
  }),
};

export type SecretOperationId = keyof typeof SECRET_OPERATIONS;
