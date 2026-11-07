import { family } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_IN_REVIEW, ASKS_NEVER, MCP_ENV_RESOLVING } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { placedCursor, projectField } from '../../../platform/contract/wire/place.js';
import { SETTABLE_SCOPES, type SettableScope } from '../../../platform/contract/wire/setting.js';
import type { PluginConsent, PluginConsented } from './consent.js';
import { PluginId, PluginLabel } from './names.js';
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
    builtin: false,
    format: 'claude-code',
    source: { kind: 'git', url: 'x'.repeat(120) },
    root: 'x'.repeat(160),
    enabled: true,
    everywhere: true,
    off: false,
    providers: { models: true, harnesses: true, speech: true },
    components: [
      ...Array.from({ length: 16 }, () => ({ kind: 'mcp-server', name: 'x'.repeat(40), detail: 'x'.repeat(80) })),
      {
        kind: 'contribution',
        name: 'x'.repeat(20),
        title: 'x'.repeat(40),
        entries: Array.from({ length: 8 }, () => ({ name: 'x'.repeat(40), title: 'x'.repeat(40) })),
      },
    ],
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
    process: { state: 'starting', tools: 100, restarts: 1000, failure: 'x'.repeat(1_000), refused: 'x'.repeat(300) },
    outdated: null,
    unhashed: 'x'.repeat(300),
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
  'plugin-package-unreachable',
  'setting-scope',
  'setting-value',
] as const;
const REACH_REFUSALS = ['mcp-reconcile-stalled', 'mcp-contributions-unreadable'] as const;

const runs = (input: { readonly enabled?: boolean }, prepared: PluginConsented): boolean => input.enabled !== false || prepared.running;

const admitted = (input: { readonly enabled?: boolean }, prepared: PluginConsented | undefined): PluginConsent =>
  prepared === undefined
    ? { subjects: [], raised: [], standing: [] }
    : runs(input, prepared)
      ? prepared.consent
      : { ...prepared.consent, subjects: prepared.consent.standing, raised: [] };

const pluginScope = Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
  description: 'project (the default): this project. user: every project, except one that switches it off.',
});

export const SWITCH_SCOPES = [...SETTABLE_SCOPES, 'machine'] as const;
export type PluginSwitchScope = (typeof SWITCH_SCOPES)[number];

const switchScope = Schema.optional(Schema.Literals(SWITCH_SCOPES)).annotate({
  description:
    'project (the default): this project. user: every project, except one that switches it off. machine: turn it off or on again on this whole machine, over both.',
});

const reachOf = (input: { readonly scope?: PluginSwitchScope }): string =>
  input.scope === 'user' ? 'every project' : input.scope === 'machine' ? 'this machine' : 'this project';

export const consentFacts = (consent: PluginConsent) => {
  const runs = consent.subjects.filter((subject) => subject.kind === 'execute').map((subject) => subject.value);
  const reaches = consent.subjects.filter((subject) => subject.kind === 'network').map((subject) => subject.value);
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
      'Read the plugins on this machine, those built into Tagma included: what each one gives the agent here, what Tagma ignores in it and why, the options it asks for, whether this project runs it and the state of its process.',
    grammar:
      'A page of rows by id with the total; `next` continues the walk, null on the last page. A component is offered as `<plugin>-<name>`. A built-in row brings providers Tagma ships and has no source or directory. `providers` says what a provider part brings; it stands on the whole machine, and `off` says the plugin is turned off on it. A refused row says why its directory as it stands now cannot be read; a failed `process` carries the end of what its process wrote; an `outdated` row runs a build older than its sources, and building the plugin again brings them in; `outdated` is null while its sources cannot be hashed, `unhashed` saying why.',
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
      'Install a plugin — in Tagma’s format (tagma-plugin.json), Agent Plugins 1.0, Claude Code or Codex — from a folder, read in place, a git URL, cloned onto this machine, an npm package, or a revision a preview prepared; installing the same source again updates it. It runs at once in this project, or with `scope: user` in every project; `enabled: false` installs it without running it in this project, and stops it here if it ran.',
    grammar:
      'Name exactly one of `source` and `prepared`. A prepared revision, as preview_plugin answers it for a marketplace entry, is installed without fetching it again and is copied into the plugin’s own directory, so the plugin never reads its marketplace. Its skills and commands join the `$` catalog, its MCP servers the pool and its agents the agent library of each project running it, each named `<plugin>-<name>`; its command hooks run as the operator. A plugin in Tagma’s format publishes its contributions while any project runs it, before its process runs; its one machine-wide process starts on the first call, tick or view that needs it and stops when quiet, or runs from the first enabling when the plugin declares it resident, and restarts after a rebuild or an option change; its tools reach agents as `plugin__<id>__<tool>`. Its provider part joins the model and speech catalogs of the whole machine at once, whatever the scope; a run already going keeps the providers it started with. A manifest whose contributions no point accepts refuses. Its remote MCP servers are connected in this project at once, so one asking for a sign-in reads `needs-sign-in` in read_mcp_servers; nothing signs in. A relative folder is read from the project root; `npm:<package>` or a scoped `@scope/name`, each with an optional `@range`, is fetched from the registry the machine’s npm configuration names.',
    input: Schema.Struct({
      project: projectField,
      source: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The plugin folder, the git URL it is cloned from, or its npm package as `npm:<name>[@range]`.',
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
            ? prepared.consent.standing.length === 0
              ? `Install the plugin ${prepared.id} on this machine without running it?`
              : `Install the plugin ${prepared.id} and its providers on this machine without running it in a project?`
            : `Install the plugin ${prepared.id} and run it in ${reachOf(input)}?`,
      facts: consentFacts(admitted(input, prepared)),
      consequence: [
        ...(prepared === undefined || prepared.consent.standing.length === 0
          ? []
          : ['Its providers run inside Tagma on this whole machine at once, whatever the projects run.']),
        prepared?.running
          ? 'It is already enabled in a project, so this version runs there at once; its process, MCP servers and hooks run as the operator on this machine wherever it is enabled.'
          : 'Its process, MCP servers and hooks run as the operator on this machine wherever it is enabled.',
      ].join(' '),
    }),
    confirmLabel: 'Install',
    presentation: { running: 'Installing a plugin', done: 'Installed a plugin' },
    subjects: (input, prepared?: PluginConsented) => admitted(input, prepared).subjects,
    raises: (input, prepared?: PluginConsented) => admitted(input, prepared).raised,
  }),
  enable_plugin: operation('enable_plugin', {
    approval: { ...ASKS_IN_REVIEW, when: [MCP_ENV_RESOLVING] },
    ...acted,
    answer,
    meaning:
      'Run a plugin in this project or in every project, or stop running it there; or turn it off on the whole machine and on again. Its tools, views, skills, commands, MCP servers, agents and hooks reach a project only while it runs there, its process may run only while some project runs it, and its providers stand while it is not turned off.',
    grammar:
      'With `scope: project`, switching off a plugin enabled for every project stops it in this project alone, and switching it on again lifts that. With `scope: user`, switching on also lifts this project’s switch-off; switching off leaves running the projects that enabled it themselves. With `scope: machine`, `enabled: false` stops it in every project and takes its providers out of the model and speech catalogs, and `enabled: true` restores what its project and personal enabling say; it is the only scope a built-in plugin takes.',
    input: Schema.Struct({
      project: projectField,
      id: PluginId,
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: 'true (the default): it runs where `scope` says. false: it stops there.',
      }),
      scope: switchScope,
    }),
    refusals: [...CHANGE_REFUSALS, ...REACH_REFUSALS, 'plugin-builtin'],
    confirmation: (input, prepared?: PluginConsented | null) => ({
      summary:
        input.scope === 'machine'
          ? input.enabled === false
            ? `Turn off the plugin ${input.id} on this machine?`
            : `Turn the plugin ${input.id} on again on this machine?`
          : input.enabled === false
            ? `Stop running the plugin ${input.id} in ${reachOf(input)}?`
            : `Run the plugin ${input.id} in ${reachOf(input)}?`,
      facts: prepared ? consentFacts(prepared.consent) : [],
      consequence:
        input.scope === 'machine' && input.enabled === false
          ? 'It runs in no project and its models and speech leave every menu until it is turned on again; a run already going keeps them.'
          : undefined,
    }),
    confirmLabel: 'Switch',
    presentation: { running: 'Switching a plugin', done: 'Switched a plugin' },
    subjects: (_input, prepared?: PluginConsented | null) => (prepared ? prepared.consent.subjects : []),
    raises: (_input, prepared?: PluginConsented | null) => (prepared ? prepared.consent.raised : []),
  }),
  create_plugin: operation('create_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer: arms({ ok: { path: Schema.String.annotate({ description: 'The new plugin folder.' }) } }),
    meaning:
      'Create a new plugin in Tagma’s format: write the SDK’s template into this project’s `.tagma-plugins/<id>/`, or among the person’s own plugins outside every repository, ready to have its dependencies installed, be built and be installed from its folder.',
    grammar:
      'The folder holds `package.json`, `plugin.ts`, its test and `.gitattributes` marking the build output generated; it carries no build yet, so install its dependencies, run `tagma-plugin build` there, then install_plugin with the folder as source — with `scope: user` for the person’s own. A folder that already stands refuses.',
    input: Schema.Struct({
      project: projectField,
      id: PluginLabel.annotate({ description: 'The plugin, which names its folder, its tools and its agents.' }),
      title: Schema.NonEmptyString.annotate({ description: 'What the person reads as its name.' }),
      scope: Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
        description:
          'project (the default): the project’s plugin, in its `.tagma-plugins/<id>/`, which its repository carries to its team. user: the person’s own, such as a theme they asked for, in Tagma’s data folder, which no repository carries.',
      }),
    }),
    refusals: ['unknown-project', 'plugin-folder-taken', 'plugin-folder-unwritable'],
    confirmation: (input) => ({
      summary: `Create the plugin ${input.id} ${input.scope === 'user' ? 'among your own plugins' : `in .tagma-plugins/${input.id}`}?`,
    }),
    confirmLabel: 'Create',
    presentation: { running: 'Creating a plugin', done: 'Created a plugin' },
    subjects: () => [],
  }),
  uninstall_plugin: operation('uninstall_plugin', {
    approval: ASKS_IN_REVIEW,
    ...acted,
    answer,
    meaning:
      'Uninstall a plugin from this machine: every project stops running it, its process ends, and its secret options and the sign-ins of the servers it brought are dropped. Its data stays.',
    input: Schema.Struct({ project: projectField, id: PluginId }),
    refusals: [...CHANGE_REFUSALS, 'plugin-builtin'],
    confirmation: (input) => ({
      summary: `Uninstall the plugin ${input.id}?`,
      consequence:
        'Every project stops running it, its process ends, its secret options and its servers’ sign-ins are dropped; its data stays, and a clone of its git URL is removed.',
    }),
    confirmLabel: 'Uninstall',
    presentation: { running: 'Uninstalling a plugin', done: 'Uninstalled a plugin' },
    subjects: () => [],
  }),
};

export type PluginOperationId = keyof typeof PLUGIN_OPERATIONS;
