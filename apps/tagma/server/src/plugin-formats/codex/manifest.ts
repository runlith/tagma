import { Effect, Schema } from 'effect';
import { type PluginAbout, type PluginIgnored, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf, isObject, jsonOf, textOf } from '../../plugins/contract/service/reading.js';

export const MANIFEST = '.codex-plugin/plugin.json';

export const INLINE = 'extensions["com.openai"]';

export const NAMESPACE = 'com.openai';

const SETTINGS = ['apps', 'hooks', 'interface', 'onboardingSkill'];
const IDENTITY = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
const COMPONENTS = ['skills', 'mcpServers'];

const Interface = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  shortDescription: Schema.optional(Schema.String),
});

const decodeInterface = Schema.decodeUnknownOption(Interface);

export type Settings = {
  readonly title: string | null;
  readonly summary: string | null;
  readonly apps: unknown;
  readonly hooks: unknown;
};

export type Legacy = {
  readonly name: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly about: PluginAbout;
  readonly skills: unknown;
  readonly mcpServers: unknown;
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

const authorOf = (value: unknown): string | null => (isObject(value) ? text(value['name']) : text(value));

export const fallbackOf = Effect.fnUntraced(function* (root: string) {
  const file = yield* entryOf(root, MANIFEST);
  if (file.kind === 'absent') return null;
  if (file.kind !== 'file') return yield* new PluginRefused({ reason: `${MANIFEST} is not a file inside the plugin` });
  const raw = jsonOf(yield* textOf(file.path));
  if ('reason' in raw) return yield* new PluginRefused({ reason: `${MANIFEST} is not JSON: ${raw.reason}` });
  if (!isObject(raw.value)) return yield* new PluginRefused({ reason: `${MANIFEST} is not a JSON object` });
  return raw.value;
});

export const legacyOf = Effect.fnUntraced(function* (raw: Readonly<Record<string, unknown>>) {
  const name = text(raw['name']);
  if (name === null) return yield* new PluginRefused({ reason: `${MANIFEST} names no plugin: name is missing` });
  return {
    name,
    version: text(raw['version']),
    description: text(raw['description']),
    about: {
      author: authorOf(raw['author']),
      homepage: text(raw['homepage']),
      repository: text(raw['repository']),
      license: text(raw['license']),
    },
    skills: raw['skills'],
    mcpServers: raw['mcpServers'],
  } satisfies Legacy;
});

export const settingsOf = (
  raw: Readonly<Record<string, unknown>>,
  label: string,
  canonical: boolean,
  ignored: PluginIgnored[],
): Settings => {
  for (const key of Object.keys(raw)) {
    if (SETTINGS.includes(key)) continue;
    if (label === INLINE) ignored.push({ component: label, name: key, reason: 'not an OpenAI setting Tagma reads' });
    else if (canonical && IDENTITY.includes(key)) continue;
    else if (canonical && COMPONENTS.includes(key)) {
      ignored.push({ component: label, name: key, reason: 'the root plugin.json with its skills/ and mcp.json is canonical' });
    } else if (!canonical && (IDENTITY.includes(key) || COMPONENTS.includes(key))) continue;
    else ignored.push({ component: label, name: key, reason: 'not a Codex plugin field Tagma reads' });
  }
  let title: string | null = null;
  let summary: string | null = null;
  if (raw['interface'] !== undefined) {
    const display = decodeInterface(raw['interface']);
    if (display._tag === 'None') {
      ignored.push({ component: 'interface', name: label, reason: 'not an object of display fields' });
    } else {
      title = text(display.value.displayName);
      summary = text(display.value.shortDescription);
    }
  }
  if (raw['onboardingSkill'] !== undefined) {
    ignored.push({
      component: 'onboardingSkill',
      name: text(raw['onboardingSkill']),
      reason: 'Tagma starts no setup conversation for a plugin',
    });
  }
  return { title, summary, apps: raw['apps'], hooks: raw['hooks'] };
};

export const appsIgnored = Effect.fnUntraced(function* (root: string, apps: unknown, ignored: PluginIgnored[]) {
  const reason = 'it names a ChatGPT app connection, and Tagma installs no app connection';
  if (apps !== undefined) ignored.push({ component: 'apps', name: text(apps), reason });
  if ((yield* entryOf(root, '.app.json')).kind !== 'absent') ignored.push({ component: '.app.json', name: null, reason });
});
