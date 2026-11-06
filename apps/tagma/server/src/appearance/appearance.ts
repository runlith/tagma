import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Themes } from './contract/service/themes.js';
import { appearance as declaration } from './contract/wire/module.js';
import { APPEARANCE_SETTING_SECTIONS, APPEARANCE_SETTINGS } from './contract/wire/settings.js';

export const appearance = manifest({
  ...declaration,
  settings: [...APPEARANCE_SETTINGS],
  settingSections: APPEARANCE_SETTING_SECTIONS,
  live: liveOf(declaration.feeds, (door: Context.Context<Themes>) => ({
    'appearance.subscribe': () => Context.get(door, Themes).catalog,
  })),
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ themesLayer }) => themesLayer,
    ),
  },
});
