import { Result, Schema } from 'effect';
import type { EntrySource, ListedEntry, ListedFault, ListFormat, MarketplaceList } from '../../marketplaces/contract/service/lists.js';
import type { PluginComponentKind } from '../../plugins/contract/wire/rows.js';
import { named } from './manifest.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const REPO = /^[\w.-]+\/[\w.-]+$/u;
const SHA = /^[0-9a-f]{40}$/u;

const Name = Schema.String.check(
  Schema.isPattern(NAME),
  Schema.makeFilter((name: string) => !name.includes('..') || 'it holds ..'),
);

const List = Schema.Struct({
  name: Name,
  owner: Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)) }),
  plugins: Schema.Array(Schema.Unknown),
  description: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Struct({ description: Schema.optional(Schema.String), pluginRoot: Schema.optional(Schema.String) })),
});

const Pinned = { ref: Schema.optional(Schema.String), sha: Schema.optional(Schema.String) };

const Source = Schema.Union([
  Schema.String,
  Schema.Struct({ source: Schema.Literal('github'), repo: Schema.String, ...Pinned }),
  Schema.Struct({ source: Schema.Literal('url'), url: Schema.String, ...Pinned }),
  Schema.Struct({ source: Schema.Literal('git-subdir'), url: Schema.String, path: Schema.String, ...Pinned }),
  Schema.Struct({ source: Schema.Literal('npm'), package: Schema.String, version: Schema.optional(Schema.String) }),
  Schema.Struct({ source: Schema.Literal('archive'), url: Schema.String }),
  Schema.Struct({ source: Schema.Literal('command'), command: Schema.String }),
]);

const Entry = Schema.Struct({
  name: Name,
  source: Source,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Unknown),
  homepage: Schema.optional(Schema.Unknown),
  repository: Schema.optional(Schema.Unknown),
  category: Schema.optional(Schema.String),
});

const decodeList = Schema.decodeUnknownResult(List);
const decodeEntry = Schema.decodeUnknownResult(Entry);

const BRINGS: readonly (readonly [string, PluginComponentKind])[] = [
  ['skills', 'skill'],
  ['commands', 'command'],
  ['agents', 'agent'],
  ['mcpServers', 'mcp-server'],
  ['hooks', 'hook'],
];

const gitUrl = (url: string): string => (REPO.test(url) ? `https://github.com/${url}.git` : url);

const relative = (path: string, root: string | undefined): EntrySource | string => {
  if (root !== undefined && !path.includes('/') && path !== '.') return relative(`${root.replace(/\/+$/u, '')}/${path}`, undefined);
  if (path !== '.' && !path.startsWith('./')) return `its source ${path} is a relative path that does not start with ./`;
  if (path.split('/').includes('..')) return `its source ${path} holds ..`;
  if (path.includes('\\')) return `its source ${path} holds a backslash`;
  return { kind: 'path', path };
};

const pinned = (sha: string | undefined): string | undefined | null => (sha === undefined ? undefined : SHA.test(sha) ? sha : null);

const sourceOf = (source: typeof Source.Type, root: string | undefined): EntrySource | string => {
  if (typeof source === 'string') return relative(source, root);
  switch (source.source) {
    case 'github':
    case 'url':
    case 'git-subdir': {
      const commit = pinned(source.sha);
      if (commit === null) return `its sha ${source.sha} is not a full lowercase commit`;
      if (source.source === 'github' && !REPO.test(source.repo)) return `its repo ${source.repo} is not owner/repo`;
      const url = source.source === 'github' ? `https://github.com/${source.repo}.git` : gitUrl(source.url);
      return { kind: 'git', url, path: source.source === 'git-subdir' ? source.path : undefined, ref: source.ref, commit };
    }
    case 'npm':
      return {
        kind: 'refused',
        shown: `npm ${source.package}${source.version === undefined ? '' : `@${source.version}`}`,
        reason: 'an npm source is fetched by npm, which Tagma does not run',
      };
    case 'archive':
      return { kind: 'refused', shown: source.url, reason: 'an archive source is a zip download Tagma does not fetch' };
    case 'command':
      return {
        kind: 'refused',
        shown: source.command,
        reason: 'a command source runs a program on this machine at install, outside the consent Tagma asks',
      };
  }
};

const entryOf = (raw: unknown, at: number, root: string | undefined): ListedEntry | ListedFault => {
  const label =
    raw !== null && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string'
      ? (raw as { name: string }).name
      : `plugins[${at}]`;
  const decoded = decodeEntry(raw);
  if (Result.isFailure(decoded)) return { name: label, reason: `not a plugin entry: ${decoded.failure.message}` };
  const entry = decoded.success;
  const source = sourceOf(entry.source, root);
  if (typeof source === 'string') return { name: entry.name, reason: source };
  const fields = raw as Readonly<Record<string, unknown>>;
  return {
    name: entry.name,
    source,
    title: entry.displayName ?? null,
    description: entry.description ?? null,
    version: entry.version ?? null,
    author: named(entry.author, 'name'),
    homepage: named(entry.homepage, 'url'),
    repository: named(entry.repository, 'url'),
    category: entry.category ?? null,
    brings: BRINGS.flatMap(([field, kind]) => (fields[field] === undefined ? [] : [kind])),
    declared: { format: 'claude-code', fields },
  };
};

const read = (text: string): MarketplaceList | { readonly refused: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { refused: `.claude-plugin/marketplace.json is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const decoded = decodeList(raw);
  if (Result.isFailure(decoded)) return { refused: `.claude-plugin/marketplace.json: ${decoded.failure.message}` };
  const list = decoded.success;
  const entries: ListedEntry[] = [];
  const faults: ListedFault[] = [];
  const seen = new Set<string>();
  list.plugins.forEach((raw, at) => {
    const entry = entryOf(raw, at, list.metadata?.pluginRoot);
    if (seen.has(entry.name)) faults.push({ name: `plugins[${at}]`, reason: `an earlier entry is named ${entry.name}` });
    else {
      seen.add(entry.name);
      if ('source' in entry) entries.push(entry);
      else faults.push(entry);
    }
  });
  return {
    name: list.name,
    title: null,
    description: list.description ?? list.metadata?.description ?? null,
    owner: list.owner.name,
    entries,
    faults,
  };
};

export const claudeCodeList: ListFormat = { id: 'claude-code', file: '.claude-plugin/marketplace.json', read };
