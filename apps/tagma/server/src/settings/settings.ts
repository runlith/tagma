import { Context } from 'effect';
import { settings as declaration } from './contract/wire/module.js';
import { type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { DeclaredSettings } from './contract/service/declarations.js';
import { Settings } from './contract/service/values.js';
import { MACHINE_REGISTRY } from '../platform/contract/service/machineRegistry.js';
import { LINKS_SETTING_SECTIONS, linksClick } from './contract/wire/links.js';
import { SHORTCUTS_SETTING_SECTIONS, shortcutBindings } from './contract/wire/shortcuts.js';
import { settingKeys } from './doctrine/keys.js';
import type { SETTINGS_FEEDS } from './contract/wire/feeds.js';

const live: LiveDeclaration<typeof SETTINGS_FEEDS, Settings | DeclaredSettings> = liveOf(declaration.feeds, async (door) => ({
  'settings.watch': (await import('./watch.js')).watchSettings(Context.get(door, Settings), Context.get(door, DeclaredSettings)),
}));

export const settings = manifest({
  ...declaration,
  settings: [linksClick, shortcutBindings],
  settingSections: [...LINKS_SETTING_SECTIONS, ...SHORTCUTS_SETTING_SECTIONS],
  sections: [
    { id: 'setting-keys', place: { prompt: 25, base: 25 }, owner: 'settings', render: settingKeys, path: 'src/settings/doctrine/keys.ts' },
  ],
  bodies: async () => Object.values((await import('./operations.js')).SETTINGS_PAIRS),
  live,
  presentation: async () => (await import('./presentation.js')).SETTINGS_PRESENTATION,
  tables: async () => {
    const [{ setting }] = await Promise.all([import('./store/table.js')]);
    return { entities: [setting], history: [] };
  },
  contributions: MACHINE_REGISTRY.of({ id: 'settings/settings', load: async () => (await import('./machineRegistry.js')).settingRows }),
});
