import { Effect } from 'effect';
import { type PluginIgnored, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf } from '../../plugins/contract/service/reading.js';
import { type Declared, ENTRY, entryFields, entryManifest, listed, type Manifest } from './manifest.js';

const COMPONENTS = ['commands', 'agents', 'skills', 'hooks', 'outputStyles', 'themes'] as const;
const MANIFEST_ONLY = ['mcpServers', 'userConfig', 'lspServers', 'channels'] as const;

export type Own = { readonly manifest: Manifest; readonly fields: readonly string[] };

export type Combined = Own & {
  readonly hooks: Readonly<Record<string, unknown>> | null;
  readonly ignored: readonly PluginIgnored[];
};

const isMap = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const standing = Effect.fnUntraced(function* (root: string, value: string | readonly string[] | undefined, fallback: string) {
  if (value !== undefined) return listed(value);
  return (yield* entryOf(root, fallback)).kind === 'directory' ? [`./${fallback}`] : [];
});

const commandsOf = Effect.fnUntraced(function* (
  root: string,
  own: Manifest['commands'],
  added: Declared['commands'],
  ignored: PluginIgnored[],
) {
  if (added === undefined) return own;
  if (isMap(own) && isMap(added)) return { ...own, ...added };
  if (isMap(own) || isMap(added)) {
    ignored.push({
      component: 'commands',
      name: ENTRY,
      reason: 'one of plugin.json and the entry names commands one by one and the other by path, so the entry’s are not added',
    });
    return own;
  }
  return [
    ...(yield* standing(root, own as string | readonly string[] | undefined, 'commands')),
    ...listed(added as string | readonly string[]),
  ];
});

export const combined = Effect.fnUntraced(function* (root: string, own: Own | null, entry: Readonly<Record<string, unknown>>) {
  if (own === null)
    return { manifest: yield* entryManifest(entry), fields: Object.keys(entry), hooks: null, ignored: [] } satisfies Combined;
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
  if (added.hooks !== undefined && !isMap(added.hooks)) {
    ignored.push({ component: 'hooks', name: ENTRY, reason: 'an entry’s hooks are an inline map of events; a path or a list is not read' });
  }
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
    agents:
      added.agents === undefined
        ? own.manifest.agents
        : [...(yield* standing(root, own.manifest.agents, 'agents')), ...listed(added.agents)],
    commands: yield* commandsOf(root, own.manifest.commands, added.commands, ignored),
  };
  return {
    manifest,
    fields: [...new Set([...own.fields, ...declaring])],
    hooks: isMap(added.hooks) ? added.hooks : null,
    ignored,
  } satisfies Combined;
});
