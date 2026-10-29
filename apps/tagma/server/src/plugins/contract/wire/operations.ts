import { family } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_IN_REVIEW, ASKS_NEVER, MCP_ENV_RESOLVING } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { placedCursor, projectField } from '../../../platform/contract/wire/place.js';
import { SETTABLE_SCOPES, type SettableScope } from '../../../platform/contract/wire/setting.js';
import type { PluginConsented } from './consent.js';
import { PluginId } from './names.js';
import { pluginRowSchema } from './rows.js';

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
  ...family('plugins', 1, 'json', { text: 6_000, json: 6_000 }, 10, () => ({
    id: 'x'.repeat(40),
    title: 'x'.repeat(60),
    version: 'x'.repeat(12),
    description: 'x'.repeat(200),
    format: 'claude-code',
    source: { kind: 'git', url: 'x'.repeat(120) },
    root: 'x'.repeat(160),
    enabled: true,
    everywhere: true,
    components: Array.from({ length: 16 }, () => ({ kind: 'mcp-server', name: 'x'.repeat(40), detail: 'x'.repeat(80) })),
    ignored: Array.from({ length: 6 }, () => ({ component: 'x'.repeat(20), name: 'x'.repeat(30), reason: 'x'.repeat(80) })),
    options: Array.from({ length: 3 }, () => ({
      key: 'x'.repeat(20),
      type: 'string',
      title: 'x'.repeat(30),
      description: 'x'.repeat(80),
      sensitive: true,
      required: false,
      set: false,
      fallback: 'x'.repeat(40),
    })),
    refused: 'x'.repeat(300),
  })),
};

const answer = arms({ ok: { plugin: pluginRowSchema } });

const acted = { ...declared, effect: 'write', identity: { key: 'call' } } as const;

const LIST_REFUSALS = ['unknown-project', 'secret-store-failed'] as const;
const CHANGE_REFUSALS = [
  ...LIST_REFUSALS,
  'plugin-not-installed',
  'plugin-refused',
  'plugin-names-collide',
  'plugin-source-unreadable',
  'plugin-clone-failed',
  'setting-scope',
  'setting-value',
] as const;
const REACH_REFUSALS = ['mcp-reconcile-stalled', 'mcp-contributions-unreadable'] as const;

const runs = (input: { readonly enabled?: boolean }, prepared: PluginConsented): boolean => input.enabled !== false || prepared.running;

const pluginScope = Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
  description: 'project (the default): this project. user: every project, except one that switches it off.',
});

const reachOf = (input: { readonly scope?: SettableScope }): string => (input.scope === 'user' ? 'every project' : 'this project');

export const consentFacts = (prepared: PluginConsented) => {
  const runs = prepared.consent.subjects.filter((subject) => subject.kind === 'execute').map((subject) => subject.value);
  const reaches = prepared.consent.subjects.filter((subject) => subject.kind === 'network').map((subject) => subject.value);
  return [
    ...(runs.length === 0 ? [] : [{ label: 'runs', value: runs.join('\n') }]),
    ...(reaches.length === 0 ? [] : [{ label: 'reaches', value: reaches.join('\n') }]),
  ];
};

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
      'Read the agent plugins installed on this machine: what each one gives the agent here, what Tagma ignores in it and why, the options it asks for, and whether this project runs it.',
    grammar:
      'A page of rows by id with the total; `next` continues the walk, null on the last page. A component is offered as `<plugin>-<name>`. A refused row says why its directory as it stands now cannot be read.',
    input: Schema.Struct({ project: projectField, limit: limitOf(PLUGIN_ROWS), cursor: placedCursor }),
    refusals: [...LIST_REFUSALS, 'bad-cursor', 'cursor-stale'],
    page: PLUGIN_ROWS,
    confirmation: () => ({ summary: 'Read the plugins?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the plugins', done: 'Read the plugins', many: (count) => `Read the plugins ${count} times` },
    subjects: () => [],
  }),
  install_plugin: operation('install_plugin', {
    approval: { ...ASKS_IN_REVIEW, when: [MCP_ENV_RESOLVING] },
    ...acted,
    answer,
    meaning:
      'Install an agent plugin — Agent Plugins 1.0, Claude Code or Codex — from a folder, read in place, a git URL, cloned onto this machine, or a revision a preview prepared; installing the same source again updates it. It runs at once in this project, or with `scope: user` in every project; `enabled: false` installs it without running it in this project, and stops it here if it ran.',
    grammar:
      'Name exactly one of `source` and `prepared`. A prepared revision, as preview_plugin answers it for a marketplace entry, is installed without fetching it again and is copied into the plugin’s own directory, so the plugin never reads its marketplace. Its skills and commands join the `$` catalog, its MCP servers the pool and its agents the agent library of each project running it, each named `<plugin>-<name>`; its command hooks run as the operator. Its remote MCP servers are connected in this project at once, so one asking for a sign-in reads `needs-sign-in` in read_mcp_servers; nothing signs in. A relative folder is read from the project root.',
    input: Schema.Struct({
      project: projectField,
      source: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The plugin folder, or the git URL it is cloned from.',
      }),
      prepared: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The prepared revision a preview answered.',
      }),
      enabled: Schema.optional(Schema.Boolean).annotate({ description: 'true (the default): it runs at once where `scope` says.' }),
      scope: pluginScope,
    }),
    refusals: [
      ...CHANGE_REFUSALS,
      ...REACH_REFUSALS,
      'plugin-id-taken',
      'plugin-pin-unreachable',
      'plugin-preview-expired',
      'field-invalid',
    ],
    confirmation: (input, prepared?: PluginConsented) => ({
      summary:
        prepared === undefined
          ? `Install the plugin from ${input.source ?? 'a prepared revision'}?`
          : input.enabled === false
            ? `Install the plugin ${prepared.id} on this machine without running it?`
            : `Install the plugin ${prepared.id} and run it in ${reachOf(input)}?`,
      facts: prepared === undefined || !runs(input, prepared) ? [] : consentFacts(prepared),
      consequence: prepared?.running
        ? 'It is already enabled in a project, so this version runs there at once; its MCP servers and hooks run as the operator on this machine wherever it is enabled.'
        : 'Its MCP servers and hooks run as the operator on this machine wherever it is enabled.',
    }),
    confirmLabel: 'Install',
    presentation: { running: 'Installing a plugin', done: 'Installed a plugin' },
    subjects: (input, prepared?: PluginConsented) => (prepared !== undefined && runs(input, prepared) ? prepared.consent.subjects : []),
    raises: (input, prepared?: PluginConsented) => (prepared !== undefined && runs(input, prepared) ? prepared.consent.raised : []),
  }),
  enable_plugin: operation('enable_plugin', {
    approval: { ...ASKS_IN_REVIEW, when: [MCP_ENV_RESOLVING] },
    ...acted,
    answer,
    meaning:
      'Run an installed plugin in this project or in every project, or stop running it there: its skills, commands, MCP servers, agents and hooks reach a project only while it runs there.',
    grammar:
      'With `scope: project`, switching off a plugin enabled for every project stops it in this project alone, and switching it on again lifts that. With `scope: user`, switching on also lifts this project’s switch-off; switching off leaves running the projects that enabled it themselves.',
    input: Schema.Struct({
      project: projectField,
      id: PluginId,
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: 'true (the default): it runs where `scope` says. false: it stops there.',
      }),
      scope: pluginScope,
    }),
    refusals: [...CHANGE_REFUSALS, ...REACH_REFUSALS],
    confirmation: (input, prepared?: PluginConsented | null) => ({
      summary:
        input.enabled === false
          ? `Stop running the plugin ${input.id} in ${reachOf(input)}?`
          : `Run the plugin ${input.id} in ${reachOf(input)}?`,
      facts: prepared ? consentFacts(prepared) : [],
    }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching a plugin', done: 'Switched a plugin' },
    subjects: (_input, prepared?: PluginConsented | null) => (prepared ? prepared.consent.subjects : []),
    raises: (_input, prepared?: PluginConsented | null) => (prepared ? prepared.consent.raised : []),
  }),
  uninstall_plugin: operation('uninstall_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning:
      'Uninstall an agent plugin from this machine: every project stops running it and its secret options are dropped. Its data stays.',
    input: Schema.Struct({ project: projectField, id: PluginId }),
    refusals: CHANGE_REFUSALS,
    confirmation: (input) => ({
      summary: `Uninstall the plugin ${input.id}?`,
      consequence:
        'Every project stops running it and its secret options are dropped; its data stays, and a clone of its git URL is removed.',
    }),
    confirmLabel: 'Uninstall',
    presentation: { running: 'Uninstalling a plugin', done: 'Uninstalled a plugin' },
    subjects: () => [],
  }),
};

export type PluginOperationId = keyof typeof PLUGIN_OPERATIONS;
