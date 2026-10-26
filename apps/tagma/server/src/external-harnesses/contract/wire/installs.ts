import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

const installed = <F extends Schema.Struct.Fields>(fields: F) =>
  Schema.Union([
    Schema.Struct({ state: Schema.Literal('missing'), target: Schema.String }),
    Schema.Struct({
      state: Schema.Literal('stale'),
      target: Schema.String,
      missing: Schema.Array(Schema.String),
      differing: Schema.Array(Schema.String),
      ...fields,
    }),
    Schema.Struct({ state: Schema.Literal('current'), target: Schema.String }),
    Schema.Struct({ state: Schema.Literal('unreadable'), target: Schema.String, path: Schema.String, reason: Schema.String }),
  ]);

const skillStatusSchema = installed({ extra: Schema.Array(Schema.String) });
const hooksStatusSchema = installed({ extra: Schema.Array(Schema.String) });
const hookLedgerSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('unsupported'), target: Schema.String }),
  Schema.Struct({ state: Schema.Literal('unreadable'), target: Schema.String, path: Schema.String, reason: Schema.String }),
  Schema.Struct({
    state: Schema.Literal('read'),
    target: Schema.String,
    path: Schema.String,
    present: Schema.Array(Schema.String),
    absent: Schema.Array(Schema.String),
  }),
]);

export const InstallationStatus = Schema.Struct({
  conflicts: Schema.Array(Schema.String),
  skill: Schema.Array(skillStatusSchema),
  hooks: Schema.NullOr(Schema.Array(hooksStatusSchema)),
  hookLedger: Schema.NullOr(Schema.Array(hookLedgerSchema)),
});
export type InstallationStatus = typeof InstallationStatus.Type;

export const INSTALL_STATUS_OPERATIONS = {
  read_installation_status: operation('read_installation_status', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: undefined,
    callers: 'any',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: InstallationStatus.fields }),
    meaning: 'Read this server installation’s merge conflicts, installed skills, hooks and hook ledger.',
    grammar:
      'This reads machine and checkout evidence beside graph findings. Unreadable installed surfaces remain named values in the answer rather than taking the whole reading down.',
    input: Schema.Struct({}),
    refusals: ['not-found', 'conflicts-unreadable'],
    confirmation: () => ({ summary: 'Read the installation evidence beside this graph?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading installation status',
      done: 'Read installation status',
      many: (count) => `Read installation status ${count} times`,
    },
    subjects: () => [],
  }),
} as const;
