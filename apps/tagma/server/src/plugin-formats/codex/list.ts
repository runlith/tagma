import { Result, Schema } from 'effect';
import type { EntrySource, ListedEntry, ListedFault, ListFormat, MarketplaceList } from '../../marketplaces/contract/service/lists.js';
import type { EntryPolicy } from '../../marketplaces/contract/wire/rows.js';

const FILE = '.agents/plugins/marketplace.json';
const SHA = /^[0-9a-f]{40}$/u;
const REPO = /^[\w.-]+\/[\w.-]+$/u;

const Shown = Schema.optional(
  Schema.Struct({ displayName: Schema.optional(Schema.String), shortDescription: Schema.optional(Schema.String) }),
);

const List = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), interface: Shown, plugins: Schema.Array(Schema.Unknown) });

const Pinned = { ref: Schema.optional(Schema.String), sha: Schema.optional(Schema.String) };

const Source = Schema.Union([
  Schema.String,
  Schema.Struct({ source: Schema.Literal('local'), path: Schema.String }),
  Schema.Struct({ source: Schema.Literal('url'), url: Schema.String, ...Pinned }),
  Schema.Struct({ source: Schema.Literal('git-subdir'), url: Schema.String, path: Schema.String, ...Pinned }),
  Schema.Struct({ source: Schema.Literal('npm'), package: Schema.String, version: Schema.optional(Schema.String) }),
]);

const Entry = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  source: Source,
  category: Schema.optional(Schema.String),
  interface: Shown,
  policy: Schema.optional(Schema.Unknown),
});

const Policy = Schema.Struct({
  installation: Schema.optional(Schema.String),
  authentication: Schema.optional(Schema.String),
  products: Schema.optional(Schema.Array(Schema.String)),
});

const decodeList = Schema.decodeUnknownResult(List);
const decodeEntry = Schema.decodeUnknownResult(Entry);
const decodePolicy = Schema.decodeUnknownOption(Policy);

const policyOf = (raw: unknown): EntryPolicy | null => {
  const policy = decodePolicy(raw);
  if (policy._tag === 'None') return null;
  const { installation, authentication, products } = policy.value;
  return { installation: installation ?? null, authentication: authentication ?? null, products: products ?? [] };
};

const local = (path: string): EntrySource | string => {
  if (!path.startsWith('./')) return `its path ${path} does not start with ./`;
  if (path.split('/').includes('..')) return `its path ${path} holds ..`;
  return { kind: 'path', path };
};

const sourceOf = (source: typeof Source.Type): EntrySource | string => {
  if (typeof source === 'string') return local(source);
  switch (source.source) {
    case 'local':
      return local(source.path);
    case 'url':
    case 'git-subdir': {
      if (source.sha !== undefined && !SHA.test(source.sha)) return `its sha ${source.sha} is not a full lowercase commit`;
      return {
        kind: 'git',
        url: REPO.test(source.url) ? `https://github.com/${source.url}.git` : source.url,
        path: source.source === 'git-subdir' ? source.path : undefined,
        ref: source.ref,
        commit: source.sha,
      };
    }
    case 'npm':
      return {
        kind: 'refused',
        shown: `npm ${source.package}${source.version === undefined ? '' : `@${source.version}`}`,
        reason: 'an npm source is fetched by npm, which Tagma does not run',
      };
  }
};

const entryOf = (raw: unknown, at: number): ListedEntry | ListedFault => {
  const label =
    raw !== null && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string'
      ? (raw as { name: string }).name
      : `plugins[${at}]`;
  const decoded = decodeEntry(raw);
  if (Result.isFailure(decoded)) return { name: label, reason: `not a plugin entry: ${decoded.failure.message}` };
  const entry = decoded.success;
  const source = sourceOf(entry.source);
  if (typeof source === 'string') return { name: entry.name, reason: source };
  return {
    name: entry.name,
    source,
    title: entry.interface?.displayName ?? null,
    description: entry.interface?.shortDescription ?? null,
    version: null,
    author: null,
    homepage: null,
    repository: null,
    category: entry.category ?? null,
    brings: [],
    policy: policyOf(entry.policy),
    manifest: null,
  };
};

const read = (text: string): MarketplaceList | { readonly refused: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { refused: `${FILE} is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const decoded = decodeList(raw);
  if (Result.isFailure(decoded)) return { refused: `${FILE}: ${decoded.failure.message}` };
  const list = decoded.success;
  const entries: ListedEntry[] = [];
  const faults: ListedFault[] = [];
  const seen = new Set<string>();
  list.plugins.forEach((raw, at) => {
    const entry = entryOf(raw, at);
    if (seen.has(entry.name)) faults.push({ name: `plugins[${at}]`, reason: `an earlier entry is named ${entry.name}` });
    else {
      seen.add(entry.name);
      if ('source' in entry) entries.push(entry);
      else faults.push(entry);
    }
  });
  return { name: list.name, title: list.interface?.displayName ?? null, description: null, owner: null, entries, faults };
};

export const codexList: ListFormat = { id: 'codex', file: FILE, read };
