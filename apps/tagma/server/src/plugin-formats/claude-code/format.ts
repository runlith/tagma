import { basename } from 'node:path';
import { Effect } from 'effect';
import type { PluginFormat, PluginIgnored, PluginPackage } from '../../plugins/contract/service/format.js';
import { pluginIdOf } from '../../plugins/contract/wire/names.js';
import { entryOf } from '../../plugins/contract/service/reading.js';
import { agentsOf, commandsOf, skillsOf } from './components.js';
import { hooksOf } from './hooks.js';
import { IGNORED_FIELDS, IGNORED_FILES, MANIFEST, type Manifest, manifestOf, optionsOf } from './manifest.js';
import { serversOf } from './servers.js';

const LAYOUT = ['skills', 'agents', 'commands', 'hooks/hooks.json', '.mcp.json'];

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  if ((yield* entryOf(root, MANIFEST)).kind === 'file') return 'manifest';
  for (const path of LAYOUT) if ((yield* entryOf(root, path)).kind !== 'absent') return 'layout';
  return null;
});

const read: PluginFormat['read'] = Effect.fn('claudeCode.read')(function* (root, claimed) {
  const declared = claimed === 'manifest' ? yield* manifestOf(root) : null;
  const manifest: Manifest | null = declared?.manifest ?? null;
  const name = manifest?.name ?? basename(root);
  const plugin = { name, id: pluginIdOf(name) };
  const ignored: PluginIgnored[] = [];
  for (const field of declared?.fields ?? []) {
    const what = IGNORED_FIELDS[field];
    if (what !== undefined) ignored.push({ component: field, name: null, reason: `Tagma does not read ${what}` });
  }
  for (const [path, what] of Object.entries(IGNORED_FILES)) {
    if ((yield* entryOf(root, path)).kind !== 'absent')
      ignored.push({ component: path, name: null, reason: `Tagma does not read ${what}` });
  }
  const options = manifest === null ? [] : yield* optionsOf(manifest);
  return {
    name,
    title: manifest?.displayName ?? null,
    version: manifest?.version ?? null,
    description: manifest?.description ?? null,
    skills: yield* skillsOf(root, name, manifest, ignored),
    commands: yield* commandsOf(root, manifest, options, ignored),
    agents: yield* agentsOf(root, plugin, manifest, options, ignored),
    servers: yield* serversOf(root, manifest, ignored),
    hooks: yield* hooksOf(root, plugin, manifest, ignored),
    options,
    ignored,
  } satisfies PluginPackage;
});

export const claudeCodeFormat: PluginFormat = { id: 'claude-code', claim, read };
