import { Schema } from 'effect';
import type { Condition, Raised } from '@runlith/agent/permissions';
import { arms, operation, type DeclaredAnswer } from '../../../platform/contract/wire/operation.js';
import { SETTABLE_SCOPES, SETTING_SCOPES } from '../../../platform/contract/wire/setting.js';
import { startPriceSchema } from '../../../platform/contract/wire/start.js';
import { projectField } from '../../../platform/contract/wire/place.js';
import { settingCatalogSchema } from './catalog.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

const CATALOG_FIELDS = { project: Schema.Struct({ id: Schema.Int, name: Schema.String }), settings: settingCatalogSchema };
const CATALOG = arms({ ok: CATALOG_FIELDS });
const WRITTEN = arms({
  ok: {
    project: CATALOG_FIELDS.project,
    key: Schema.String,
    value: Schema.Unknown,
    from: Schema.Literals(SETTING_SCOPES),
    start: Schema.optional(startPriceSchema),
  },
});
const LAYER_WRITTEN = arms({ ok: { ...CATALOG_FIELDS, start: Schema.optional(startPriceSchema) } });

export type SettingWriteAnswer = DeclaredAnswer<typeof WRITTEN>;

export type WriteScope = { readonly project: string; readonly machine: boolean; readonly consents: readonly Raised[] };

export const OPERATOR_CHOICE: Condition = { id: 'operator-choice', label: "The operator's choice", asksFrom: 'review', timeout: 'none' };

export const SETTING_LAYER: Condition = { id: 'setting-layer', label: 'Setting layer', asksFrom: 'review', timeout: 'none' };

export const SETTINGS_OPERATIONS = {
  read_settings: operation('read_settings', {
    approval: ASKS_NEVER,
    doors: { http: true },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    waits: [],
    graph: 'none',
    lifetimes: [],
    place: 'project',
    effect: 'read',
    identity: 'none',
    answer: CATALOG,
    meaning: 'Read effective settings with each key’s source scope, author and agent writability.',
    input: Schema.Struct({
      project: projectField,
      section: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'One section alone: the first segment of its keys, as `agent` for `agent.offered`; omit for the whole catalog.',
      }),
    }),
    refusals: ['unknown-project'],
    confirmation: (input) => ({
      summary: input.section === undefined ? 'Read all effective settings?' : `Read the ${input.section} settings?`,
    }),
    confirmLabel: 'Read',
    presentation: {
      running: "Reading the project's settings",
      done: "Read the project's settings",
      many: (count) => `Read the project's settings ${count} times`,
    },
    subjects: () => [],
  }),
  write_setting: operation('write_setting', {
    approval: { asksFrom: 'trust', timeout: 'none', when: [OPERATOR_CHOICE] },
    doors: { http: true },
    tool: { capability: 'graph' },
    callers: 'any',
    subject: 'none',
    waits: [],
    graph: 'none',
    lifetimes: [],
    place: 'project',
    effect: 'write',
    identity: { key: 'call' },
    answer: WRITTEN,
    meaning:
      'Set or clear a setting, in the named project’s scope or for the whole machine where the key has no project scope. Returns its new effective value and the project written.',
    grammar:
      'Use a key read_settings names, with a value of the shape its `holds` line gives. Omit `value` to clear the override. Managed keys require the operation named in the settings catalog.\nThe keys with no project scope are the machine’s: `agent.checkoutWorld`, `agent.delegation` — write it only on the operator’s word. Under trust and review the reader confirms the write first; under bypass it lands.',
    input: Schema.Struct({
      project: projectField,
      key: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The key id, as `read_settings` spells it.',
      }),
      value: Schema.optional(Schema.Unknown).annotate({
        description: 'Omit to clear the project override and use inherited/default settings.',
      }),
    }),
    refusals: [
      'unknown-setting',
      'setting-managed',
      'setting-scope',
      'setting-value',
      'setting-conflict',
      'unknown-catalog',
      'field-invalid',
      'unknown-project',
      'git-refused',
      'git-unreadable',
      'git-incomplete',
    ],
    confirmation: (input, prepared: WriteScope) => {
      const machine = prepared.machine;
      const where = machine ? 'for every project on this machine' : `for project “${prepared.project}”`;
      return {
        summary:
          input.value === undefined ? `Clear ${input.key} ${where}?` : `Set ${input.key} to ${JSON.stringify(input.value)} ${where}?`,
        consequence: machine
          ? 'The machine is configured from now on: every project on it reads what this key decides.'
          : `Project “${prepared.project}” is configured from now on: every session it opens reads what this key decides.`,
      };
    },
    confirmLabel: 'Write',
    presentation: { running: 'Configuring the project', done: 'Configured the project' },
    subjects: () => [],
    raises: (_input, prepared?: WriteScope) => prepared?.consents ?? [],
  }),
  write_setting_layer: operation('write_setting_layer', {
    approval: { ...ASKS_IN_REVIEW, when: [SETTING_LAYER] },
    doors: { http: true },
    tool: undefined,
    callers: 'any',
    subject: 'none',
    waits: [],
    graph: 'none',
    lifetimes: [],
    place: 'machine',
    effect: 'write',
    identity: { key: 'call' },
    answer: LAYER_WRITTEN,
    meaning: 'Set, clear or decline one setting at an explicit operator configuration layer.',
    grammar:
      'This is the operator-layer act used by the settings surface. `user` applies across projects; `project` writes this project’s layer. `declined` records that a project refuses a weaker list value.',
    input: Schema.Struct({
      scope: Schema.Literals(SETTABLE_SCOPES),
      key: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The key id, as read_settings spells it.',
      }),
      value: Schema.optional(Schema.Unknown).annotate({
        description: 'Omit to clear this layer.',
      }),
      declined: Schema.optional(Schema.Boolean).annotate({
        description: 'A project layer declining the weaker list value.',
      }),
    }),
    refusals: [
      'unknown-setting',
      'setting-managed',
      'setting-scope',
      'setting-value',
      'setting-conflict',
      'unknown-catalog',
      'field-invalid',
      'unknown-project',
      'git-refused',
      'git-unreadable',
      'git-incomplete',
    ],
    confirmation: (input, prepared: WriteScope) => ({
      summary: `${input.value === undefined ? 'Clear' : 'Write'} ${input.key} at ${input.scope === 'user' ? 'the machine layer' : `project “${prepared.project}”’s layer`}?`,
      consequence:
        input.scope === 'user'
          ? 'The machine layer changes for every project.'
          : `Project “${prepared.project}”’s layer changes without changing the machine default.`,
    }),
    confirmLabel: 'Write',
    presentation: {
      running: 'Configuring a setting layer',
      done: 'Configured a setting layer',
    },
    subjects: () => [],
    raises: (_input, prepared: WriteScope) => prepared.consents,
  }),
};

export type SettingsOperationId = keyof typeof SETTINGS_OPERATIONS;
export const SETTINGS_OPERATION_IDS = Object.keys(SETTINGS_OPERATIONS) as readonly SettingsOperationId[];
