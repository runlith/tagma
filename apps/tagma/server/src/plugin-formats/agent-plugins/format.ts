import { Effect, Schema } from 'effect';
import { type PluginFormat, type PluginIgnored, type PluginPackage, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf, jsonOf, skillFolders, textOf } from '../../plugins/contract/service/reading.js';
import { serversOf } from './servers.js';

export const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';

const SCHEMA_FAMILY = /^https:\/\/agent-plugins\.org\/schemas\/[^/]+\/plugin\.schema\.json$/u;
const NAME = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const OUTSIDE_V1 = ['agents', 'commands', 'hooks'];

const fields = {
  $schema: Schema.String,
  name: Schema.String,
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  author: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.String), email: Schema.optional(Schema.String), url: Schema.optional(Schema.String) }),
  ),
  homepage: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
  keywords: Schema.optional(Schema.Array(Schema.String)),
  extensions: Schema.optional(Schema.Unknown),
};

const KNOWN = new Set(Object.keys(fields));

const Manifest = Schema.Struct(fields);

const decodeManifest = Schema.decodeUnknownEffect(Manifest);

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const manifestText = Effect.fnUntraced(function* (root: string) {
  const file = yield* entryOf(root, 'plugin.json');
  if (file.kind !== 'file') return null;
  const raw = jsonOf(yield* textOf(file.path));
  return 'reason' in raw ? { failure: raw.reason } : { value: raw.value };
});

const claim: PluginFormat['claim'] = Effect.fnUntraced(function* (root) {
  const read = yield* manifestText(root);
  if (read === null || !('value' in read) || !isObject(read.value)) return null;
  const schema = read.value['$schema'];
  return typeof schema === 'string' && SCHEMA_FAMILY.test(schema) ? 'manifest' : null;
});

const read: PluginFormat['read'] = Effect.fn('agentPlugins.read')(function* (root) {
  const text = yield* manifestText(root);
  if (text === null) return yield* new PluginRefused({ reason: 'plugin.json is not a file inside the plugin' });
  if ('failure' in text) return yield* new PluginRefused({ reason: `plugin.json is not JSON: ${text.failure}` });
  if (!isObject(text.value)) return yield* new PluginRefused({ reason: 'plugin.json is not a JSON object' });
  const raw = text.value;
  if (raw['$schema'] !== PLUGIN_SCHEMA) {
    return yield* new PluginRefused({
      reason: `plugin.json: $schema ${JSON.stringify(raw['$schema'])} is not an Agent Plugins version Tagma reads; it reads ${PLUGIN_SCHEMA}`,
    });
  }
  const ignored: PluginIgnored[] = [];
  for (const key of Object.keys(raw)) {
    if (!KNOWN.has(key))
      ignored.push({ component: 'plugin.json', name: key, reason: 'not an Agent Plugins 1.0 field, so it is reported and ignored' });
  }
  const manifest = yield* decodeManifest(raw).pipe(
    Effect.mapError((failure) => new PluginRefused({ reason: `plugin.json: ${failure.message}` })),
  );
  const author = raw['author'];
  if (isObject(author)) {
    const extra = Object.keys(author).find((key) => key !== 'name' && key !== 'email' && key !== 'url');
    if (extra !== undefined) return yield* new PluginRefused({ reason: `plugin.json: author holds ${extra}, beside name, email and url` });
  }
  if (manifest.name.length < 1 || manifest.name.length > 64 || !NAME.test(manifest.name)) {
    return yield* new PluginRefused({
      reason: `plugin.json: name ${JSON.stringify(manifest.name)} is not 1–64 lowercase letters, digits, - and ., starting and ending alphanumeric, with no -- or ..`,
    });
  }
  if (manifest.extensions !== undefined) {
    if (!isObject(manifest.extensions))
      ignored.push({ component: 'plugin.json', name: 'extensions', reason: 'not an object, so it is reported and ignored' });
    else {
      for (const namespace of Object.keys(manifest.extensions)) {
        ignored.push({ component: 'extension', name: namespace, reason: 'a client extension Tagma does not implement' });
      }
    }
  }
  for (const directory of OUTSIDE_V1) {
    if ((yield* entryOf(root, directory)).kind === 'directory') {
      ignored.push({ component: directory, name: null, reason: 'outside the Agent Plugins 1.0 component types' });
    }
  }
  const skills = yield* skillFolders(root, 'skills', ignored);
  const servers = yield* serversOf(root, ignored);
  return {
    name: manifest.name,
    title: null,
    version: manifest.version ?? null,
    description: manifest.description ?? null,
    skills,
    commands: [],
    agents: [],
    servers,
    hooks: [],
    options: [],
    ignored,
  } satisfies PluginPackage;
});

export const agentPluginsFormat: PluginFormat = { id: 'agent-plugins', claim, read };
