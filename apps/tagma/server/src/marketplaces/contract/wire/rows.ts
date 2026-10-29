import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PLUGIN_COMPONENT_KINDS } from '../../../plugins/contract/wire/rows.js';

const Named = Schema.String.check(Schema.isMinLength(1));
const Said = Schema.NullOr(Schema.String);

export const TRUST_LABELS = ['tagma', 'vendor', 'unreviewed'] as const;
export type TrustLabel = (typeof TRUST_LABELS)[number];

export const MARKETPLACE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;

export const MarketplaceId = Schema.String.check(Schema.isPattern(MARKETPLACE_ID_PATTERN), Schema.isMaxLength(128)).annotate({
  description: 'The marketplace, by the name its list gives itself, in lowercase.',
});

export const MarketplaceSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('git'), url: Named }),
  Schema.Struct({ kind: Schema.Literal('folder'), path: Named }),
]);
export type MarketplaceSource = typeof MarketplaceSource.Type;

export const marketplaceRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Said,
  owner: Said,
  label: Schema.Literals(TRUST_LABELS).annotate({
    description:
      'Tagma’s trust label: tagma for its own marketplace, vendor for Anthropic’s and OpenAI’s at their fixed URLs, unreviewed for one added by its address.',
  }),
  source: MarketplaceSource,
  format: Said.annotate({ description: 'The list format of its stored revision; null before its first fetch succeeded.' }),
  revision: Schema.NullOr(
    Schema.Struct({
      commit: Said.annotate({ description: 'The commit of its list; null for a folder read in place.' }),
      fetched: Schema.String.annotate({ description: 'When the stored list was fetched, ISO 8601.' }),
    }),
  ).annotate({ description: 'The stored list its entries are read from; null before its first fetch succeeded.' }),
  failure: Schema.NullOr(Schema.Struct({ reason: Schema.String, at: Schema.String })).annotate({
    description: 'The last fetch that failed since the stored list, which stays.',
  }),
  entries: Schema.Int.annotate({ description: 'How many entries the stored list carries, refused ones included.' }),
});
export type MarketplaceRow = typeof marketplaceRowSchema.Type;

export const ENTRY_STATES = ['available', 'installed', 'taken', 'refused'] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export const entryRowSchema = Schema.Struct({
  marketplace: Schema.String,
  name: Schema.String.annotate({ description: 'The entry’s name in its marketplace.' }),
  plugin: Said.annotate({ description: 'The plugin it installs as, read from its name; null when the name gives none.' }),
  title: Said,
  description: Said,
  version: Said,
  author: Said,
  homepage: Said,
  repository: Said,
  category: Said,
  brings: Schema.Array(Schema.Literals(PLUGIN_COMPONENT_KINDS)).annotate({
    description: 'The components the entry itself says the plugin brings.',
  }),
  source: Schema.String.annotate({ description: 'Where its files are, as the list says.' }),
  state: Schema.Literals(ENTRY_STATES).annotate({
    description:
      'available: installable; installed: installed from this entry; taken: its plugin is installed from another source; refused: Tagma does not install it.',
  }),
  reason: Schema.optional(Schema.String).annotate({ description: 'Why a refused entry is not installed.' }),
  taken: Schema.optional(Schema.String).annotate({ description: 'The source its plugin is installed from instead.' }),
});
export type EntryRow = typeof entryRowSchema.Type;

export const MARKETPLACES_FEED = feed('marketplaces.subscribe', {
  input: Schema.Struct({}),
  event: Schema.Struct({ marketplaces: Schema.Array(marketplaceRowSchema), entries: Schema.Array(entryRowSchema) }),
  refusals: [],
  callers: 'operator',
  graph: 'none',
});

export const MARKETPLACE_FEEDS = [MARKETPLACES_FEED] as const;
