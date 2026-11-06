import { THEMES_POINT } from '@tagma/server/appearance/contract/wire/format';
import { Layer } from '@runlith/layer/Layer';
import { CardParts } from '$lib/features/plugins/parts.js';
import { ChoiceSets } from '$lib/features/settings/controls/catalogs.js';
import { SectionContributions, SettingSections } from '$lib/features/settings/section.js';
import { MenuParts } from '$lib/shared/window/parts.js';
import { Appearance } from './Appearance.svelte.js';
import MenuRow from './MenuRow.svelte';
import PluginThemes from './PluginThemes.svelte';
import { contributions, sections } from './settings.js';

export const AppearanceLayer = Layer.mergeAll(
  Appearance,
  ChoiceSets.contribute('appearance', { of: 'theme', entries: (app) => app.resolve(Appearance).entries }),
  SettingSections.contribute('appearance', ...sections),
  SectionContributions.contribute('appearance', ...contributions),
  MenuParts.contribute('appearance', { id: 'appearance-theme', place: 'view', order: 1, payload: { component: MenuRow } }),
  CardParts.contribute('appearance', { contribution: THEMES_POINT, order: 1, payload: { component: PluginThemes } }),
);
