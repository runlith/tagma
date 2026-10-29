import { Schema } from 'effect';
import { settingListKey } from '../../../platform/contract/wire/setting.js';
import { TagmaAppId } from './manifest.js';

export const TagmaAppInstall = Schema.Struct({
  id: TagmaAppId,
  source: Schema.String.check(Schema.isMinLength(1)),
  enabled: Schema.Boolean,
});
export type TagmaAppInstall = typeof TagmaAppInstall.Type;

export const tagmaAppsInstalled = settingListKey({
  id: 'apps.installed',
  order: 760,
  title: 'Installed',
  description:
    'Each app installed on this machine, the directory it runs from and whether its process runs; it stands apart from every project.',
  control: { kind: 'managed', by: 'install_app' },
  member: TagmaAppInstall,
  fallback: [] as readonly TagmaAppInstall[],
  scopes: ['user'],
  merge: 'replace',
});

export const tagmaAppsEnabled = settingListKey({
  id: 'apps.enabled',
  order: 761,
  title: 'Enabled here',
  description: 'The installed apps whose tools and views this project sees.',
  control: { kind: 'managed', by: 'enable_app' },
  member: TagmaAppId,
  fallback: [] as readonly string[],
  scopes: ['project'],
  merge: 'replace',
});

export const TAGMA_APP_SETTING_SECTIONS = [
  {
    id: 'apps',
    order: 62,
    title: 'Apps',
    description: 'Apps installed on this machine and the ones each project sees.',
  },
] as const;
