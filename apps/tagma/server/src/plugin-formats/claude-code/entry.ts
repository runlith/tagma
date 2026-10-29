import { Effect } from 'effect';
import { type PluginIgnored, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf, isObject } from '../../plugins/contract/service/reading.js';
import { type CommandParts, commandParts, ENTRY, entryFields, entryManifest, listed, type Manifest } from './manifest.js';

const COMPONENTS = ['commands', 'agents', 'skills', 'hooks', 'outputStyles', 'themes'] as const;
const MANIFEST_ONLY = ['mcpServers', 'userConfig', 'lspServers', 'channels'] as const;

export type Own = { readonly manifest: Manifest; readonly fields: readonly string[] };

export type Combined = {
  readonly manifest: Manifest | null;
  readonly fields: readonly string[];
  readonly commands: CommandParts | undefined;
  readonly hooks: Readonly<Record<string, unknown>> | null;
  readonly ignored: readonly PluginIgnored[];
};

export const ownOnly = (own: Own | null): Combined => ({
  manifest: own?.manifest ?? null,
  fields: own?.fields ?? [],
  commands: commandParts(own?.manifest.commands),
  hooks: null,
  ignored: [],
});

const standing = Effect.fnUntraced(function* <A>(root: string, parts: readonly A[] | undefined, fallback: string) {
  if (parts !== undefined) return parts;
  return (yield* entryOf(root, fallback)).kind === 'directory' ? [`./${fallback}`] : [];
});

export const combined = Effect.fnUntraced(function* (root: string, own: Own | null, entry: Readonly<Record<string, unknown>>) {
  if (own === null) {
    const manifest = yield* entryManifest(entry);
    return { manifest, fields: Object.keys(entry), commands: commandParts(manifest.commands), hooks: null, ignored: [] } satisfies Combined;
  }
  const declaring = COMPONENTS.filter((field) => entry[field] !== undefined);
  if (entry['strict'] === false && declaring.length > 0) {
    return yield* new PluginRefused({
      reason: `its plugin.json and its marketplace entry both declare components (${declaring.join(', ')}), and the entry sets strict: false`,
    });
  }
  const ignored: PluginIgnored[] = MANIFEST_ONLY.filter((field) => entry[field] !== undefined).map((field) => ({
    component: field,
    name: ENTRY,
    reason: `an entry’s ${field} applies only to a plugin without its own plugin.json`,
  }));
  const added = yield* entryFields(entry);
  if (added.hooks !== undefined && !isObject(added.hooks)) {
    ignored.push({ component: 'hooks', name: ENTRY, reason: 'an entry’s hooks are an inline map of events; a path or a list is not read' });
  }
  const ownAgents = own.manifest.agents === undefined ? undefined : listed(own.manifest.agents);
  const ownCommands = commandParts(own.manifest.commands);
  const addedCommands = commandParts(added.commands);
  const manifest: Manifest = {
    ...own.manifest,
    displayName: added.displayName ?? own.manifest.displayName,
    description: added.description ?? own.manifest.description,
    author: added.author ?? own.manifest.author,
    homepage: added.homepage ?? own.manifest.homepage,
    repository: added.repository ?? own.manifest.repository,
    license: added.license ?? own.manifest.license,
    version: own.manifest.version ?? added.version,
    skills: added.skills === undefined ? own.manifest.skills : [...listed(own.manifest.skills), ...listed(added.skills)],
    agents: added.agents === undefined ? own.manifest.agents : [...(yield* standing(root, ownAgents, 'agents')), ...listed(added.agents)],
  };
  return {
    manifest,
    fields: [...new Set([...own.fields, ...declaring])],
    commands: addedCommands === undefined ? ownCommands : [...(yield* standing(root, ownCommands, 'commands')), ...addedCommands],
    hooks: isObject(added.hooks) ? added.hooks : null,
    ignored,
  } satisfies Combined;
});
