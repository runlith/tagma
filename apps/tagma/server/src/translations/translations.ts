import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Translations } from './contract/service/translations.js';
import { TRANSLATION_FEED } from './contract/wire/feed.js';
import { translations as declaration } from './contract/wire/module.js';
import { TRANSLATION_SETTING_KEYS, TRANSLATION_SETTING_SECTIONS } from './contract/wire/settings.js';

export const translations = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).TRANSLATION_PAIRS),
  live: liveOf([TRANSLATION_FEED] as const, (door: Context.Context<Translations>) => ({
    'translations.changes': ({ projectId }: { readonly projectId: number }) => Context.get(door, Translations).changes(projectId),
  })),
  settings: [...TRANSLATION_SETTING_KEYS],
  settingSections: TRANSLATION_SETTING_SECTIONS,
  tables: async () => {
    const { translationAct, translationPart } = await import('./store/tables.js');
    return { entities: [translationAct, translationPart], history: [] };
  },
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ translationsLayer }) => translationsLayer,
    ),
  },
});
