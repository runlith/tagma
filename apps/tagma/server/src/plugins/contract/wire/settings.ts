import { Schema } from 'effect';
import { settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';
import { PluginId } from './names.js';
import { PluginSource } from './rows.js';

export const PluginInstall = Schema.Struct({
  id: PluginId,
  source: PluginSource,
  root: Schema.String.check(Schema.isMinLength(1)),
});
export type PluginInstall = typeof PluginInstall.Type;

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
  title: 'Enabled here',
  description: 'The installed plugins whose skills, commands, MCP servers, agents and hooks this project runs.',
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
  order: 772,
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
    description: 'Agent plugins installed on this machine and the ones each project runs.',
  },
] as const;
