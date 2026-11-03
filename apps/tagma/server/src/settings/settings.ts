import { settings as declaration } from './contract/wire/module.js';
import { manifest } from '../platform/contract/service/manifest.js';
import { MACHINE_REGISTRY } from '../platform/contract/service/machineRegistry.js';
import { APPEARANCE_SETTING_SECTIONS, loadInStatusBar } from './contract/wire/appearance.js';
import { LINKS_SETTING_SECTIONS, linksClick } from './contract/wire/links.js';
import { settingKeys } from './doctrine/keys.js';

export const settings = manifest({
  ...declaration,
  settings: [loadInStatusBar, linksClick],
  settingSections: [...APPEARANCE_SETTING_SECTIONS, ...LINKS_SETTING_SECTIONS],
  sections: [
    { id: 'setting-keys', place: { prompt: 25, base: 25 }, owner: 'settings', render: settingKeys, path: 'src/settings/doctrine/keys.ts' },
  ],
  bodies: async () => Object.values((await import('./operations.js')).SETTINGS_PAIRS),
  presentation: async () => (await import('./presentation.js')).SETTINGS_PRESENTATION,
  tables: async () => {
    const [{ setting }] = await Promise.all([import('./store/table.js')]);
    return { entities: [setting], history: [] };
  },
  contributions: MACHINE_REGISTRY.of({ id: 'settings/settings', load: async () => (await import('./machineRegistry.js')).settingRows }),
});
