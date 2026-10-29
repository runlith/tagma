import { Effect, Schema } from 'effect';
import { type PluginAbout, type PluginIgnored, type PluginOption, PluginRefused } from '../../plugins/contract/service/format.js';
import { entryOf, jsonOf, type PluginEntry, textOf } from '../../plugins/contract/service/reading.js';

export const MANIFEST = '.claude-plugin/plugin.json';

const Paths = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const CommandEntry = Schema.Struct({
  source: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  argumentHint: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  allowedTools: Schema.optional(Schema.Array(Schema.String)),
});
export type CommandEntry = typeof CommandEntry.Type;

const Option = Schema.Struct({
  type: Schema.Literals(['string', 'number', 'boolean', 'directory', 'file']),
  title: Schema.String,
  description: Schema.String,
  required: Schema.optional(Schema.Boolean),
  default: Schema.optional(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Array(Schema.String)])),
  options: Schema.optional(Schema.Array(Schema.String)),
  multiple: Schema.optional(Schema.Boolean),
  sensitive: Schema.optional(Schema.Boolean),
  min: Schema.optional(Schema.Finite),
  max: Schema.optional(Schema.Finite),
});

const FIELDS = {
  displayName: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  author: Schema.optional(Schema.Unknown),
  homepage: Schema.optional(Schema.Unknown),
  repository: Schema.optional(Schema.Unknown),
  license: Schema.optional(Schema.Unknown),
  skills: Schema.optional(Paths),
  commands: Schema.optional(Schema.Union([Paths, Schema.Record(Schema.String, Schema.Unknown)])),
  agents: Schema.optional(Paths),
  hooks: Schema.optional(Schema.Unknown),
  mcpServers: Schema.optional(Schema.Unknown),
  userConfig: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
};

const Manifest = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), ...FIELDS });
export type Manifest = typeof Manifest.Type;

const Declared = Schema.Struct(FIELDS);
export type Declared = typeof Declared.Type;

const decodeManifest = Schema.decodeUnknownEffect(Manifest);
const decodeDeclared = Schema.decodeUnknownEffect(Declared);
const decodeOption = Schema.decodeUnknownEffect(Option);
const decodeCommand = Schema.decodeUnknownEffect(CommandEntry);

const OPTION_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export const IGNORED_FIELDS: Readonly<Record<string, string>> = {
  lspServers: 'LSP servers',
  outputStyles: 'output styles',
  workflows: 'workflows',
  experimental: 'themes, monitors and evals',
  themes: 'themes',
  monitors: 'monitors',
  channels: 'channels',
  settings: 'plugin settings',
  dependencies: 'dependencies on other plugins',
};

export const IGNORED_FILES: Readonly<Record<string, string>> = {
  '.lsp.json': 'LSP servers',
  'output-styles': 'output styles',
  workflows: 'workflows',
  themes: 'themes',
  'monitors/monitors.json': 'monitors',
  bin: 'executables on the shell PATH',
  'settings.json': 'plugin settings',
};

export const manifestOf = Effect.fnUntraced(function* (root: string) {
  const file = yield* entryOf(root, MANIFEST);
  if (file.kind !== 'file') return yield* new PluginRefused({ reason: `${MANIFEST} is not a file inside the plugin` });
  const raw = jsonOf(yield* textOf(file.path));
  if ('reason' in raw) return yield* new PluginRefused({ reason: `${MANIFEST} is not JSON: ${raw.reason}` });
  const manifest = yield* decodeManifest(raw.value).pipe(
    Effect.mapError((failure) => new PluginRefused({ reason: `${MANIFEST}: ${failure.message}` })),
  );
  const fields = raw.value !== null && typeof raw.value === 'object' ? Object.keys(raw.value) : [];
  return { manifest, fields };
});

export const ENTRY = 'its marketplace entry';

export const entryManifest = (entry: Readonly<Record<string, unknown>>) =>
  decodeManifest(entry).pipe(Effect.mapError((failure) => new PluginRefused({ reason: `${ENTRY}: ${failure.message}` })));

export const entryFields = (entry: Readonly<Record<string, unknown>>) =>
  decodeDeclared(entry).pipe(Effect.mapError((failure) => new PluginRefused({ reason: `${ENTRY}: ${failure.message}` })));

const named = (value: unknown, key: 'name' | 'url'): string | null => {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const inner = (value as Readonly<Record<string, unknown>>)[key];
  return typeof inner === 'string' && inner.length > 0 ? inner : null;
};

export const aboutOf = (manifest: Manifest | null): PluginAbout => ({
  author: named(manifest?.author, 'name'),
  homepage: named(manifest?.homepage, 'url'),
  repository: named(manifest?.repository, 'url'),
  license: named(manifest?.license, 'name'),
});

export const optionsOf = Effect.fnUntraced(function* (manifest: Manifest) {
  const options: PluginOption[] = [];
  for (const [key, raw] of Object.entries(manifest.userConfig ?? {})) {
    if (!OPTION_KEY.test(key)) return yield* new PluginRefused({ reason: `${MANIFEST}: userConfig key ${key} is not an identifier` });
    const option = yield* decodeOption(raw, { onExcessProperty: 'error' }).pipe(
      Effect.mapError((failure) => new PluginRefused({ reason: `${MANIFEST}: userConfig.${key}: ${failure.message}` })),
    );
    const fallback =
      option.default === undefined ? null : Array.isArray(option.default) ? option.default.join(',') : String(option.default);
    options.push({
      key,
      type: option.type,
      title: option.title,
      description: option.description,
      sensitive: option.sensitive === true,
      required: option.required === true,
      fallback,
    });
  }
  return options;
});

export const commandEntryOf = Effect.fnUntraced(function* (name: string, raw: unknown) {
  const entry = yield* decodeCommand(raw, { onExcessProperty: 'error' }).pipe(
    Effect.mapError((failure) => new PluginRefused({ reason: `${MANIFEST}: commands.${name}: ${failure.message}` })),
  );
  if ((entry.source === undefined) === (entry.content === undefined)) {
    return yield* new PluginRefused({ reason: `${MANIFEST}: commands.${name} sets exactly one of source and content` });
  }
  return entry;
});

export const listed = (value: string | readonly string[] | undefined): readonly string[] =>
  value === undefined ? [] : typeof value === 'string' ? [value] : value;

export const declaredPath = Effect.fnUntraced(function* (
  root: string,
  component: string,
  path: string,
  ignored: PluginIgnored[],
  allowRoot = false,
) {
  if (!path.startsWith('./') && !(allowRoot && path === '.')) {
    ignored.push({ component, name: path, reason: 'a manifest path starts with ./' });
    return null;
  }
  const entry: PluginEntry = yield* entryOf(root, path);
  if (entry.kind === 'outside') ignored.push({ component, name: path, reason: 'the path escapes the plugin directory' });
  else if (entry.kind === 'absent') ignored.push({ component, name: path, reason: 'the path does not exist' });
  else return entry;
  return null;
});
