import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';
import { PluginId } from './names.js';
import { PluginDeclared, PluginOrigin, PluginSource } from './rows.js';

export const PluginInstall = Schema.Struct({
  id: PluginId,
  source: PluginSource,
  root: Schema.String.check(Schema.isMinLength(1)),
  origin: Schema.optional(PluginOrigin),
  declared: Schema.optional(PluginDeclared),
});
export type PluginInstall = typeof PluginInstall.Type;

export const installedFrom = (install: Pick<PluginInstall, 'source' | 'origin'>): string =>
  install.origin !== undefined
    ? `${install.origin.entry}@${install.origin.marketplace}`
    : install.source.kind === 'folder'
      ? install.source.path
      : install.source.path === undefined
        ? install.source.url
        : `${install.source.url} ${install.source.path}`;

export const pluginsInstalled = settingListKey({
  id: 'plugins.installed',
  order: 770,
  title: 'Installed',
  description: 'Each plugin installed on this machine: where it came from and the directory it is read from.',
  control: { kind: 'managed', by: 'install_plugin' },
  member: PluginInstall,
  fallback: [] as readonly PluginInstall[],
  scopes: ['user'],
  merge: 'replace',
});

export const pluginsEnabled = settingListKey({
  id: 'plugins.enabled',
  order: 771,
  title: 'Enabled',
  description:
    'The installed plugins whose tools, views, skills, commands, MCP servers, agents and hooks run: your own layer runs them in every project, a project’s layer in that project.',
  control: { kind: 'managed', by: 'enable_plugin' },
  member: PluginId,
  fallback: [] as readonly string[],
  scopes: SETTABLE_SCOPES,
  merge: 'union',
});

export const pluginsDisabled = settingListKey({
  id: 'plugins.disabled',
  order: 772,
  title: 'Switched off here',
  description: 'The plugins enabled for every project that this project does not run.',
  control: { kind: 'managed', by: 'enable_plugin' },
  member: PluginId,
  fallback: [] as readonly string[],
  scopes: ['project'],
  merge: 'replace',
});

export const PluginOptionValues = Schema.Record(PluginId, Schema.Record(Schema.String, Schema.String));
export type PluginOptionValues = typeof PluginOptionValues.Type;

export const pluginsOptions = settingKey({
  id: 'plugins.options',
  order: 773,
  title: 'Options',
  description: 'The values each plugin asks for that are not secret, by plugin and option; a secret one lives in the key store.',
  schema: PluginOptionValues,
  fallback: {} as PluginOptionValues,
  scopes: ['user'],
  merge: 'replace',
});

export const PLUGIN_SETTING_SECTIONS = [
  {
    id: 'plugins',
    order: 63,
    title: 'Plugins',
    description: 'Plugins installed on this machine, the marketplaces they come from, and where each one runs.',
  },
] as const;
