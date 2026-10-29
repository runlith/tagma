import { resolve } from 'node:path';
import { within } from '../plugins/contract/service/reading.js';
import { PLUGIN_ID_PATTERN, pluginIdOf } from '../plugins/contract/wire/names.js';
import { installedFrom, type PluginInstall } from '../plugins/contract/wire/settings.js';
import type { EntrySource, ListedEntry } from './contract/service/lists.js';
import type { EntryRow } from './contract/wire/rows.js';
import type { Revision } from './revisions.js';

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

const pluginOf = (name: string): string | null => {
  const id = pluginIdOf(name);
  return PLUGIN_ID_PATTERN.test(id) && id.length <= 64 ? id : null;
};

const rowOf = (marketplace: string, root: string, entry: ListedEntry, installs: readonly PluginInstall[]): EntryRow => {
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
    category: entry.category,
    brings: entry.brings,
    source: sourceLine(entry.source),
  };
  if (entry.source.kind === 'refused') return { ...shown, state: 'refused', reason: entry.source.reason };
  if (entry.source.kind === 'path' && escapes(root, entry.source.path)) {
    return { ...shown, state: 'refused', reason: `its path ${entry.source.path} leaves the marketplace` };
  }
  if (installs.some((install) => install.origin?.marketplace === marketplace && install.origin.entry === entry.name)) {
    return { ...shown, state: 'installed' };
  }
  const holder = plugin === null ? undefined : installs.find((install) => install.id === plugin);
  return holder === undefined ? { ...shown, state: 'available' } : { ...shown, state: 'taken', taken: installedFrom(holder) };
};

export const entryRows = (marketplace: string, revision: Revision, installs: readonly PluginInstall[]): readonly EntryRow[] => [
  ...revision.list.entries.map((entry) => rowOf(marketplace, revision.root, entry, installs)),
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
    state: 'refused',
    reason: fault.reason,
  })),
];

export const entryRowOf = (marketplace: string, revision: Revision, entry: ListedEntry, installs: readonly PluginInstall[]): EntryRow =>
  rowOf(marketplace, revision.root, entry, installs);
