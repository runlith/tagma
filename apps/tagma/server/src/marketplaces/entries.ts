import { resolve } from 'node:path';
import { within } from '../plugins/contract/service/reading.js';
import { PLUGIN_ID_PATTERN, pluginIdOf } from '../plugins/contract/wire/names.js';
import { installedFrom, type PluginInstall } from '../plugins/contract/wire/settings.js';
import { categoryOf } from './categories.js';
import type { EntrySource, ListedEntry } from './contract/service/lists.js';
import type { EntryRow } from './contract/wire/rows.js';
import type { Revision } from './revisions.js';

export type Installed = { readonly byId: ReadonlyMap<string, PluginInstall>; readonly origins: ReadonlySet<string> };

const originKey = (marketplace: string, entry: string): string => `${marketplace}\u0000${entry}`;

export const installedOf = (installs: readonly PluginInstall[]): Installed => ({
  byId: new Map(installs.map((install) => [install.id, install])),
  origins: new Set(
    installs.flatMap((install) => (install.origin === undefined ? [] : [originKey(install.origin.marketplace, install.origin.entry)])),
  ),
});

export const sourceLine = (source: EntrySource): string => {
  switch (source.kind) {
    case 'path':
      return source.path;
    case 'git':
      return [source.url, source.path, source.commit ?? source.ref].filter((part) => part !== undefined).join(' ');
    case 'refused':
      return source.shown;
  }
};

export const escapes = (root: string, path: string): boolean => !within(root, resolve(root, path));

export const pluginOf = (name: string): string | null => {
  const id = pluginIdOf(name);
  return PLUGIN_ID_PATTERN.test(id) && id.length <= 64 ? id : null;
};

export const entryRowOf = (marketplace: string, root: string, entry: ListedEntry, installed: Installed): EntryRow => {
  const plugin = pluginOf(entry.name);
  const shown = {
    marketplace,
    name: entry.name,
    plugin,
    title: entry.title,
    description: entry.description,
    version: entry.version,
    author: entry.author,
    homepage: entry.homepage,
    repository: entry.repository,
    category: categoryOf(entry.category),
    brings: entry.brings,
    source: sourceLine(entry.source),
    policy: entry.policy,
  };
  if (entry.source.kind === 'refused') return { ...shown, state: 'refused', reason: entry.source.reason };
  if (plugin === null) {
    return {
      ...shown,
      state: 'refused',
      reason: `its name ${entry.name} cannot name a plugin: Tagma takes lowercase letters, digits, - and _`,
    };
  }
  if (entry.source.kind === 'path' && escapes(root, entry.source.path)) {
    return { ...shown, state: 'refused', reason: `its path ${entry.source.path} leaves the marketplace` };
  }
  if (installed.origins.has(originKey(marketplace, entry.name))) return { ...shown, state: 'installed' };
  const holder = installed.byId.get(plugin);
  return holder === undefined ? { ...shown, state: 'available' } : { ...shown, state: 'taken', taken: installedFrom(holder) };
};

export const entryRows = (marketplace: string, revision: Revision, installed: Installed): readonly EntryRow[] => [
  ...revision.list.entries.map((entry) => entryRowOf(marketplace, revision.root, entry, installed)),
  ...revision.list.faults.map((fault): EntryRow => ({
    marketplace,
    name: fault.name,
    plugin: null,
    title: null,
    description: null,
    version: null,
    author: null,
    homepage: null,
    repository: null,
    category: null,
    brings: [],
    source: '',
    policy: null,
    state: 'refused',
    reason: fault.reason,
  })),
];
