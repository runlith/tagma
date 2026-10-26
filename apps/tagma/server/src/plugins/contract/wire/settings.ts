import { Schema } from 'effect';
import { settingListKey } from '../../../platform/contract/wire/setting.js';
import { PluginId } from './manifest.js';

export const PluginInstall = Schema.Struct({
  id: PluginId,
  source: Schema.String.check(Schema.isMinLength(1)),
  enabled: Schema.Boolean,
});
export type PluginInstall = typeof PluginInstall.Type;

export const pluginsInstalled = settingListKey({
  id: 'plugins.installed',
  order: 760,
  title: 'Installed',
  description:
    'Each plugin installed on this machine, the directory it runs from and whether its process runs; it stands apart from every project.',
  control: { kind: 'managed', by: 'install_plugin' },
  member: PluginInstall,
  fallback: [] as readonly PluginInstall[],
  scopes: ['user'],
  merge: 'replace',
});

export const pluginsEnabled = settingListKey({
  id: 'plugins.enabled',
  order: 761,
  title: 'Enabled here',
  description: 'The installed plugins whose tools and views this project sees.',
  control: { kind: 'managed', by: 'enable_plugin' },
  member: PluginId,
  fallback: [] as readonly string[],
  scopes: ['project'],
  merge: 'replace',
});

export const PLUGIN_SETTING_SECTIONS = [
  {
    id: 'plugins',
    order: 62,
    title: 'Plugins',
    description: 'Plugins installed on this machine and the ones each project sees.',
  },
] as const;
