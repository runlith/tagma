import { basename } from 'node:path';
import { Effect } from 'effect';
import type { PluginFormat, PluginIgnored, PluginPackage, PluginPlace } from '../../plugins/contract/service/format.js';
import { contentSubstitution, substituted } from './variables.js';
import { pluginIdOf } from '../../plugins/contract/wire/names.js';
import { entryOf } from '../../plugins/contract/service/reading.js';
import { agentsOf, commandsOf, skillsOf } from './components.js';
import { type Combined, combined, ownOnly } from './entry.js';
import { hooksOf } from './hooks.js';
import { aboutOf, IGNORED_FIELDS, IGNORED_FILES, MANIFEST, type Manifest, manifestOf, optionsOf } from './manifest.js';
import { serversOf } from './servers.js';

const LAYOUT = ['skills', 'agents', 'commands', 'hooks/hooks.json', '.mcp.json', 'SKILL.md'];

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  if ((yield* entryOf(root, MANIFEST)).kind === 'file') return 'manifest';
  for (const path of LAYOUT) if ((yield* entryOf(root, path)).kind !== 'absent') return 'layout';
  return null;
});

const read: PluginFormat['read'] = Effect.fn('claudeCode.read')(function* (root, claimed, entry) {
  const own = claimed === 'manifest' ? yield* manifestOf(root) : null;
  const declared: Combined = entry?.fields == null ? ownOnly(own) : yield* combined(root, own, entry.fields);
  const manifest: Manifest | null = declared.manifest;
  const name = entry?.name ?? manifest?.name ?? basename(root);
  const plugin = { name, id: pluginIdOf(name) };
  const ignored: PluginIgnored[] = [...declared.ignored];
  for (const field of declared.fields) {
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
    about: aboutOf(manifest),
    skills: (yield* skillsOf(root, name, manifest, ignored)).map((skill) => ({
      ...skill,
      render: (text: string, place: PluginPlace) => substituted(text, place, contentSubstitution(options)),
    })),
    commands: yield* commandsOf(root, declared.commands, options, ignored),
    agents: yield* agentsOf(root, plugin, manifest, options, ignored),
    servers: yield* serversOf(root, manifest, ignored),
    hooks: yield* hooksOf(root, plugin, manifest, ignored, declared.hooks),
    options,
    process: null,
    providers: null,
    build: null,
    contributes: {},
    ignored,
  } satisfies PluginPackage;
});

export const claudeCodeFormat: PluginFormat = { id: 'claude-code', claim, read };
