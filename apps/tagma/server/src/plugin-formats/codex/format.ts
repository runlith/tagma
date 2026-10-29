import { Effect } from 'effect';
import { readPortable, rootManifest } from '../agent-plugins/portable.js';
import {
  type PluginFormat,
  type PluginIgnored,
  type PluginPackage,
  PluginRefused,
  type PluginSkillFile,
} from '../../plugins/contract/service/format.js';
import { declaredPath, entryOf, isObject, skillFolders } from '../../plugins/contract/service/reading.js';
import { pluginIdOf } from '../../plugins/contract/wire/names.js';
import { hooksOf } from './hooks.js';
import { appsIgnored, fallbackOf, INLINE, legacyOf, MANIFEST, NAMESPACE, type Settings, settingsOf } from './manifest.js';
import { serversOf } from './servers.js';

const NO_SETTINGS: Settings = { title: null, summary: null, apps: undefined, hooks: undefined };

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  if ((yield* entryOf(root, MANIFEST)).kind === 'file') return 'manifest';
  const extensions = (yield* rootManifest(root))?.['extensions'];
  return isObject(extensions) && isObject(extensions[NAMESPACE]) ? 'manifest' : null;
});

const skillsOf = Effect.fnUntraced(function* (root: string, declared: unknown, ignored: PluginIgnored[]) {
  if (declared === undefined) return yield* skillFolders(root, 'skills', ignored);
  const skills: PluginSkillFile[] = [];
  for (const shape of Array.isArray(declared) ? declared : [declared]) {
    if (typeof shape !== 'string') {
      ignored.push({ component: 'skills', name: null, reason: 'a skills entry is not a path' });
      continue;
    }
    if ((yield* declaredPath(root, 'skills', shape, ignored)) !== null) skills.push(...(yield* skillFolders(root, shape, ignored)));
  }
  return skills;
});

const readLegacy = Effect.fnUntraced(function* (root: string, raw: Readonly<Record<string, unknown>>) {
  const ignored: PluginIgnored[] = [];
  const legacy = yield* legacyOf(raw);
  const settings = settingsOf(raw, MANIFEST, false, ignored);
  yield* appsIgnored(root, settings.apps, ignored);
  return {
    name: legacy.name,
    title: settings.title,
    version: legacy.version,
    description: legacy.description ?? settings.summary,
    about: legacy.about,
    skills: yield* skillsOf(root, legacy.skills, ignored),
    commands: [],
    agents: [],
    servers: yield* serversOf(root, legacy.mcpServers, ignored),
    hooks: yield* hooksOf(root, { name: legacy.name, id: pluginIdOf(legacy.name) }, settings.hooks, ignored),
    options: [],
    ignored,
  } satisfies PluginPackage;
});

const readPortableOverlay = Effect.fnUntraced(function* (root: string, fallback: Readonly<Record<string, unknown>> | null) {
  const ignored: PluginIgnored[] = [];
  const portable = yield* readPortable(root, [NAMESPACE]);
  const inline = portable.extensions?.[NAMESPACE];
  let settings = NO_SETTINGS;
  if (isObject(inline)) {
    settings = settingsOf(inline, INLINE, true, ignored);
    if (fallback !== null) ignored.push({ component: MANIFEST, name: null, reason: `${INLINE} in the root plugin.json replaces it` });
  } else if (fallback !== null) settings = settingsOf(fallback, MANIFEST, true, ignored);
  if ((yield* entryOf(root, '.mcp.json')).kind !== 'absent') {
    ignored.push({ component: '.mcp.json', name: null, reason: 'a portable package reads mcp.json' });
  }
  yield* appsIgnored(root, settings.apps, ignored);
  const found = portable.package;
  return {
    ...found,
    title: settings.title,
    description: found.description ?? settings.summary,
    hooks: yield* hooksOf(root, { name: found.name, id: pluginIdOf(found.name) }, settings.hooks, ignored),
    ignored: [...found.ignored, ...ignored],
  } satisfies PluginPackage;
});

const read: PluginFormat['read'] = Effect.fn('codex.read')(function* (root, _claim, declared) {
  if (declared !== null) {
    return yield* new PluginRefused({ reason: 'a Codex plugin is its own manifest: a marketplace entry declares none for it' });
  }
  const fallback = yield* fallbackOf(root);
  if ((yield* rootManifest(root)) !== null) return yield* readPortableOverlay(root, fallback);
  if (fallback === null) return yield* new PluginRefused({ reason: `${MANIFEST} is not a file inside the plugin` });
  return yield* readLegacy(root, fallback);
});

export const codexFormat: PluginFormat = { id: 'codex', claim, read };
