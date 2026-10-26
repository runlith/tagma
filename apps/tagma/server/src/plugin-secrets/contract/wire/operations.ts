import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { PluginId } from '../../../plugins/contract/wire/manifest.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { SecretName } from './entries.js';
import { pluginSecretSetSchema, SECRET_CHANGE_REFUSALS, SECRET_READ_REFUSALS, SECRET_REMOVE_REFUSALS, secretRowSchema } from './rows.js';

const operatorOnly = { doors: { http: true }, callers: 'operator', subject: 'none', place: 'home', waits: [], lifetimes: [] } as const;

export const SECRET_ROWS = {
  ...family('plugin-secrets', 1, 'json', { text: 3_500, json: 3_500 }, 20, () => ({
    plugin: 'x'.repeat(40),
    title: 'x'.repeat(80),
    secrets: Array.from({ length: 8 }, () => ({ name: 'X'.repeat(64), description: 'x'.repeat(300), set: false })),
    missing: 8,
  })),
};

const named = { plugin: PluginId, name: SecretName };

export const SECRET_OPERATIONS = {
  read_plugin_secrets: operation('read_plugin_secrets', {
    approval: ASKS_NEVER,
    ...operatorOnly,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        plugins: Schema.Array(pluginSecretSetSchema),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
      },
    }),
    meaning:
      'Read the secrets each installed plugin declares in plugin.json, with whether the operator has given each a value and how many are still missing.',
    grammar:
      'A page of plugins by id that declare secrets, with the total; `next` continues the walk, null on the last page. A plugin declares its secrets once its plugin.json has been read, which an installed, enabled plugin has. The values are never answered.',
    input: Schema.Struct({ limit: limitOf(SECRET_ROWS), cursor: PAGE_CURSOR }),
    refusals: [...SECRET_READ_REFUSALS, 'bad-cursor', 'cursor-stale'],
    page: SECRET_ROWS,
    confirmation: () => ({ summary: 'Read which plugin secrets have a value?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the plugin secrets', done: 'Read the plugin secrets' },
    subjects: () => [],
  }),
  set_plugin_secret: operation('set_plugin_secret', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: { plugin: Schema.String, secret: secretRowSchema } }),
    meaning:
      'Give a secret a plugin declares its value: the plugin’s process restarts once with the value in the environment variable of the secret’s name, and what the process answers over MCP is masked where it carries the value.',
    grammar:
      'Only a secret an installed, enabled plugin declares in plugin.json is set. The value is kept on this machine and never read back; an empty value, or one over 16384 characters or holding a NUL, refuses. Answers once the restart has finished; a plugin that then fails shows it in read_plugins.',
    input: Schema.Struct({ ...named, value: Schema.String }),
    refusals: SECRET_CHANGE_REFUSALS,
    confirmation: (input) => ({
      summary: `Give ${input.name} of the plugin ${input.plugin} a value?`,
      consequence: 'The plugin’s process restarts with it.',
    }),
    confirmLabel: 'Set secret',
    presentation: { running: 'Setting a plugin secret', done: 'Set a plugin secret' },
    subjects: () => [],
  }),
  remove_plugin_secret: operation('remove_plugin_secret', {
    approval: ASKS_IN_REVIEW,
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    intent: 'destructive',
    destructiveConsequence: (input) => `The value of ${input.name} for the plugin ${input.plugin} is removed from this machine.`,
    answer: arms({ ok: { plugin: Schema.String, secret: secretRowSchema } }),
    meaning:
      'Remove the value of a secret a plugin declares, or one left behind by a plugin that is gone: a running process restarts once without it.',
    input: Schema.Struct(named),
    refusals: SECRET_REMOVE_REFUSALS,
    confirmation: (input) => ({
      summary: `Remove ${input.name} of the plugin ${input.plugin}?`,
      consequence: 'The plugin’s process restarts without it.',
    }),
    confirmLabel: 'Remove secret',
    presentation: { running: 'Removing a plugin secret', done: 'Removed a plugin secret' },
    subjects: () => [],
  }),
};

export type SecretOperationId = keyof typeof SECRET_OPERATIONS;
