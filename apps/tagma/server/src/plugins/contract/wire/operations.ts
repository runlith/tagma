import { family } from '@runlith/paging';
import { Schema } from 'effect';
import type { ProjectRef } from '../../../projects/contract/wire/project.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { PluginId } from './manifest.js';
import { pluginRowSchema } from './rows.js';
import { placedCursor, projectField } from '../../../platform/contract/wire/place.js';

const declared = {
  doors: { http: true },
  tool: { capability: 'plugins' },
  callers: 'any',
  subject: 'none',
  place: 'project',
  waits: [],
  lifetimes: [],
} as const;

export const PLUGIN_ROWS = {
  ...family('plugins', 1, 'json', { text: 2_100, json: 2_100 }, 20, () => ({
    id: 'x'.repeat(40),
    title: 'x'.repeat(80),
    root: 'x'.repeat(200),
    floor: 'project',
    installed: { source: 'x'.repeat(200), enabled: true },
    enabled: true,
    state: 'starting',
    tools: 100,
    restarts: 1000,
    failure: 'x'.repeat(1_000),
    refused: 'x'.repeat(300),
  })),
};

const answer = arms({ ok: { plugin: pluginRowSchema } });

const acted = { ...declared, effect: 'write', identity: { key: 'call' } } as const;

const named = Schema.Struct({ id: PluginId });

const LIST_REFUSALS = ['not-found', 'plugin-floor-unreadable', 'unknown-project'] as const;
const CHANGE_REFUSALS = [...LIST_REFUSALS, 'plugin-not-installed', 'setting-scope', 'setting-value'] as const;

export const PLUGIN_OPERATIONS = {
  read_plugins: operation('read_plugins', {
    approval: ASKS_NEVER,
    ...declared,
    answer: arms({
      ok: { plugins: Schema.Array(pluginRowSchema), shown: Schema.Int, total: Schema.Int, next: Schema.NullOr(Schema.String) },
    }),
    effect: 'read',
    identity: 'none',
    meaning:
      "Read the plugins this project finds in its .plugins directory and the operator's, with what is installed on this machine, what this project sees and each process's state.",
    grammar:
      'A page of rows by id with the total; `next` continues the walk, null on the last page. A plugin is a directory named as its id holding plugin.json. A refused row says why its directory as it stands now cannot run; a failed row carries the end of what its process wrote. Starts nothing.',
    input: Schema.Struct({ project: projectField, limit: limitOf(PLUGIN_ROWS), cursor: placedCursor }),
    refusals: [...LIST_REFUSALS, 'bad-cursor', 'cursor-stale'],
    page: PLUGIN_ROWS,
    confirmation: () => ({ summary: 'Read the plugins and their state?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the plugins', done: 'Read the plugins', many: (count) => `Read the plugins ${count} times` },
    subjects: () => [],
  }),
  read_plugin_schema: operation('read_plugin_schema', {
    approval: ASKS_NEVER,
    ...declared,
    place: 'machine',
    answer: arms({ ok: { schema: Schema.Unknown } }),
    effect: 'read',
    identity: 'none',
    meaning: 'Read the JSON Schema of plugin.json: the envelope and every contribution point this server declares.',
    input: Schema.Struct({}),
    refusals: [],
    confirmation: () => ({ summary: 'Read the schema of plugin.json?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the plugin schema', done: 'Read the plugin schema' },
    subjects: () => [],
  }),
  install_plugin: operation('install_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning:
      'Install a plugin this project finds, by its id: the machine records the directory it runs from, starts its process and this project sees it. `enabled: false` keeps it installed with its process stopped.',
    grammar: `The process starts once and serves every project; each restarts it when its files change, except ui/. It runs as the operator with no further permission asked.
An id standing in both floors, or installed from another directory, refuses with both paths. A plugin.json the server refuses refuses with its reason.`,
    input: Schema.Struct({
      project: projectField,
      id: PluginId,
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: 'true (the default): its process runs. false: it stays installed, stopped.',
      }),
    }),
    refusals: [
      ...LIST_REFUSALS,
      'plugin-unknown',
      'plugin-collision',
      'plugin-source-taken',
      'plugin-refused',
      'setting-scope',
      'setting-value',
    ],
    confirmation: (input, project: ProjectRef) => ({
      summary:
        input.enabled === false
          ? `Install the plugin ${input.id} for project “${project.name}” with its process stopped?`
          : `Install and start the plugin ${input.id} for project “${project.name}”?`,
      consequence:
        input.enabled === false
          ? 'Its directory is recorded on this machine; its process stays stopped.'
          : `Its process runs as the operator on this machine, and project “${project.name}” sees its tools.`,
    }),
    confirmLabel: 'Install',
    presentation: { running: 'Installing a plugin', done: 'Installed a plugin' },
    subjects: () => [],
  }),
  uninstall_plugin: operation('uninstall_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    place: 'home',
    answer,
    meaning:
      'Uninstall a plugin from this machine: its process ends, its contributions are withdrawn everywhere and its secret values are dropped. Its data stays.',
    input: named,
    refusals: [...CHANGE_REFUSALS, 'secret-store-failed'],
    confirmation: (input) => ({
      summary: `Uninstall the plugin ${input.id}?`,
      consequence: 'Its process ends, every project stops seeing it and its secret values are dropped; its data and its directory stay.',
    }),
    confirmLabel: 'Uninstall',
    presentation: { running: 'Uninstalling a plugin', done: 'Uninstalled a plugin' },
    subjects: () => [],
  }),
  enable_plugin: operation('enable_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning: 'Show an installed plugin to this project or hide it: its tools and views reach this project only while it is enabled here.',
    grammar: 'Its process is the machine’s and keeps running either way.',
    input: Schema.Struct({
      project: projectField,
      id: PluginId,
      enabled: Schema.optional(Schema.Boolean).annotate({ description: 'true (the default): this project sees it. false: hidden here.' }),
    }),
    refusals: CHANGE_REFUSALS,
    confirmation: (input, project: ProjectRef) => ({
      summary:
        input.enabled === false
          ? `Hide the plugin ${input.id} from project “${project.name}”?`
          : `Enable the plugin ${input.id} in project “${project.name}”?`,
    }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching a plugin', done: 'Switched a plugin' },
    subjects: () => [],
  }),
};

export type PluginOperationId = keyof typeof PLUGIN_OPERATIONS;
