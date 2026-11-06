import { family, PAGE_CURSOR } from '@runlith/paging';
import { Schema } from 'effect';
import { ASKS_IN_REVIEW, ASKS_NEVER, MCP_ENV_RESOLVING } from '../../../platform/contract/wire/conditions.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { projectField } from '../../../platform/contract/wire/place.js';
import type { PluginConsented } from '../../../plugins/contract/wire/consent.js';
import { PluginId } from '../../../plugins/contract/wire/names.js';
import { consentFacts } from '../../../plugins/contract/wire/operations.js';
import { pluginPreviewSchema, pluginRowSchema } from '../../../plugins/contract/wire/rows.js';
import { entryRowSchema, MarketplaceId, marketplaceRowSchema } from './rows.js';

const machine = { doors: { http: true }, subject: 'none', place: 'machine', graph: 'none', waits: [], lifetimes: [] } as const;

const placed = { doors: { http: true }, subject: 'none', place: 'project', graph: 'none', waits: [], lifetimes: [] } as const;

const offered = { callers: 'any', tool: { capability: 'plugins' } } as const;

const operatorOnly = { callers: 'operator', approval: ASKS_NEVER } as const;

export const MARKETPLACE_ENTRIES = {
  ...family('marketplace-entries', 1, 'json', { text: 1_400, json: 1_400 }, 40, () => ({
    marketplace: 'x'.repeat(30),
    name: 'x'.repeat(40),
    plugin: 'x'.repeat(40),
    title: 'x'.repeat(60),
    description: 'x'.repeat(300),
    version: 'x'.repeat(12),
    author: 'x'.repeat(40),
    homepage: 'x'.repeat(80),
    repository: 'x'.repeat(80),
    category: 'x'.repeat(30),
    brings: ['skill', 'command', 'mcp-server', 'agent', 'hook'],
    source: 'x'.repeat(160),
    state: 'available',
    reason: 'x'.repeat(200),
  })),
};

const marketplaceAnswer = arms({ ok: { marketplace: marketplaceRowSchema } });

const STORE = ['setting-scope', 'setting-value'] as const;
const ENTRY_REFUSALS = ['marketplace-unknown', 'marketplace-unfetched', 'marketplace-entry-unknown', 'marketplace-entry-refused'] as const;
const PREPARE_REFUSALS = [
  ...ENTRY_REFUSALS,
  'unknown-project',
  'secret-store-failed',
  'plugin-source-unreadable',
  'plugin-clone-failed',
  'plugin-package-unreachable',
  'plugin-pin-unreachable',
  'plugin-refused',
  'plugin-names-collide',
  'plugin-id-taken',
] as const;

export const MARKETPLACE_OPERATIONS = {
  read_marketplaces: operation('read_marketplaces', {
    ...machine,
    ...offered,
    approval: ASKS_NEVER,
    effect: 'read',
    identity: 'none',
    answer: arms({
      ok: {
        marketplaces: Schema.Array(marketplaceRowSchema),
        entries: Schema.Array(entryRowSchema),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(Schema.String),
      },
    }),
    meaning:
      'Read the plugin marketplaces this machine reads, with Tagma’s trust label and stored list of each, and a page of their entries with each one’s install state.',
    grammar:
      'Marketplaces stand in trust order — Tagma’s own, the vendors’, then those added by address — each kind in the order it was added. Entries come from each marketplace’s stored list, ordered by marketplace and name; `next` continues the walk. An entry is installed from its marketplace by preview_plugin, then install_plugin with the revision it prepared. A refused entry says why Tagma does not install it; a taken one names where its plugin is installed from.',
    input: Schema.Struct({
      marketplace: Schema.optional(MarketplaceId).annotate({ description: 'Only this marketplace and its entries.' }),
      limit: limitOf(MARKETPLACE_ENTRIES),
      cursor: PAGE_CURSOR,
    }),
    refusals: ['marketplace-unknown', 'bad-cursor', 'cursor-stale'],
    page: MARKETPLACE_ENTRIES,
    confirmation: () => ({ summary: 'Read the plugin marketplaces?' }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading the plugin marketplaces',
      done: 'Read the plugin marketplaces',
      many: (count) => `Read the plugin marketplaces ${count} times`,
    },
    subjects: () => [],
  }),
  refresh_marketplace: operation('refresh_marketplace', {
    ...machine,
    ...offered,
    approval: ASKS_NEVER,
    effect: 'external',
    identity: { key: 'call' },
    answer: marketplaceAnswer,
    meaning: 'Fetch a marketplace’s list again and store it; installed plugins stay as they are.',
    grammar:
      'A failed fetch keeps the stored list, which the marketplace’s row shows beside the failure. update_plugin moves an installed plugin to what the stored list now says.',
    input: Schema.Struct({ id: MarketplaceId }),
    refusals: ['marketplace-unknown', 'marketplace-unreachable', 'marketplace-unreadable'],
    confirmation: (input) => ({ summary: `Fetch the list of ${input.id} again?` }),
    confirmLabel: 'Refresh',
    presentation: { running: 'Refreshing a marketplace', done: 'Refreshed a marketplace' },
    subjects: () => [],
  }),
  preview_plugin: operation('preview_plugin', {
    ...placed,
    ...offered,
    approval: ASKS_NEVER,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({ ok: { entry: entryRowSchema, preview: pluginPreviewSchema } }),
    meaning:
      'Prepare a marketplace entry’s plugin and read it before installing: what Tagma takes and ignores, the consent installing asks, its options and who made it.',
    grammar:
      'The package is fetched once and held as `preview.prepared`; install_plugin with that `prepared` installs this same revision. A held revision is dropped after a day or a server restart. Runs nothing of the plugin.',
    input: Schema.Struct({
      project: projectField,
      marketplace: MarketplaceId,
      entry: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The entry’s name in that marketplace.' }),
    }),
    refusals: PREPARE_REFUSALS,
    confirmation: (input) => ({ summary: `Prepare ${input.entry} from ${input.marketplace}?` }),
    confirmLabel: 'Preview',
    presentation: { running: 'Previewing a plugin', done: 'Previewed a plugin' },
    subjects: () => [],
  }),
  inspect_source: operation('inspect_source', {
    ...placed,
    ...offered,
    approval: ASKS_NEVER,
    effect: 'external',
    identity: { key: 'call' },
    answer: arms({
      ok: {
        found: Schema.Union([
          Schema.Struct({
            kind: Schema.Literal('marketplace'),
            name: Schema.String,
            title: Schema.NullOr(Schema.String),
            description: Schema.NullOr(Schema.String),
            entries: Schema.Int,
          }),
          Schema.Struct({ kind: Schema.Literal('plugin'), preview: pluginPreviewSchema }),
        ]),
      },
    }),
    meaning: 'Read what a git URL or folder holds before adding it: a marketplace list, or one plugin prepared for install.',
    grammar:
      'A marketplace is named with its list; add_marketplace adds it. A plugin is answered as preview_plugin answers an entry, and install_plugin with its `prepared` installs that revision. Adds and runs nothing.',
    input: Schema.Struct({
      project: projectField,
      source: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'A git URL, or the absolute path of a folder.' }),
    }),
    refusals: [
      'field-invalid',
      'marketplace-unreachable',
      'marketplace-unreadable',
      'unknown-project',
      'secret-store-failed',
      'plugin-source-unreadable',
      'plugin-clone-failed',
      'plugin-package-unreachable',
      'plugin-pin-unreachable',
      'plugin-refused',
      'plugin-names-collide',
      'plugin-id-taken',
    ],
    confirmation: (input) => ({ summary: `Read what ${input.source} holds?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading an address', done: 'Read an address' },
    subjects: () => [],
  }),
  add_marketplace: operation('add_marketplace', {
    ...machine,
    ...operatorOnly,
    effect: 'external',
    identity: { key: 'call' },
    answer: marketplaceAnswer,
    meaning: 'Add a plugin marketplace by its git URL or folder: its list is fetched and stored, and its entries become installable.',
    grammar:
      'A git URL is cloned shallow into the server’s data directory; a folder is read where it stands. It is named by its list’s name and labelled unreviewed, unless it is one of the vendor marketplaces at its fixed URL.',
    input: Schema.Struct({
      source: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The git URL of the marketplace, or the absolute path of its folder.',
      }),
    }),
    refusals: ['marketplace-taken', 'marketplace-unreachable', 'marketplace-unreadable', 'field-invalid', ...STORE],
    confirmation: (input) => ({ summary: `Add the marketplace at ${input.source}?` }),
    confirmLabel: 'Add',
    presentation: { running: 'Adding a marketplace', done: 'Added a marketplace' },
    subjects: () => [],
  }),
  remove_marketplace: operation('remove_marketplace', {
    ...machine,
    ...operatorOnly,
    effect: 'write',
    identity: { key: 'call' },
    answer: marketplaceAnswer,
    meaning: 'Remove a plugin marketplace and its stored list; the plugins installed from it keep working and no longer update.',
    grammar: 'A removed preset stays removed.',
    input: Schema.Struct({ id: MarketplaceId }),
    refusals: ['marketplace-unknown', 'marketplace-unreachable', ...STORE],
    confirmation: (input) => ({
      summary: `Remove the marketplace ${input.id}?`,
      consequence: 'Plugins installed from it keep working; they no longer update.',
    }),
    confirmLabel: 'Remove',
    presentation: { running: 'Removing a marketplace', done: 'Removed a marketplace' },
    subjects: () => [],
  }),
  update_plugin: operation('update_plugin', {
    ...placed,
    callers: 'operator',
    approval: { ...ASKS_IN_REVIEW, when: [MCP_ENV_RESOLVING] },
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: { plugin: pluginRowSchema } }),
    meaning:
      'Update a plugin installed from a marketplace to what its entry says in the marketplace’s stored list, asking consent for the new version as installing does.',
    grammar: 'A plugin whose marketplace was removed, or whose entry left the list, does not update and says why.',
    input: Schema.Struct({ project: projectField, id: PluginId }),
    refusals: [
      ...PREPARE_REFUSALS,
      'plugin-not-installed',
      'plugin-without-marketplace',
      'marketplace-gone',
      'plugin-preview-expired',
      ...STORE,
    ],
    confirmation: (input, prepared?: PluginConsented) => ({
      summary: `Update the plugin ${input.id} from its marketplace?`,
      facts: prepared === undefined ? [] : consentFacts(prepared),
      consequence: 'The new version runs at once wherever the plugin is enabled; its MCP servers and hooks run as the operator.',
    }),
    confirmLabel: 'Update',
    presentation: { running: 'Updating a plugin', done: 'Updated a plugin' },
    subjects: (_input, prepared?: PluginConsented) => prepared?.consent.subjects ?? [],
    raises: (_input, prepared?: PluginConsented) => prepared?.consent.raised ?? [],
  }),
};

export type MarketplaceOperationId = keyof typeof MARKETPLACE_OPERATIONS;
