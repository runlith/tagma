import type { PluginFace } from '../../../platform/contract/wire/contribution.js';
import { THEME_MODES, ThemeEntries } from './format.js';
import { meaningRefusal } from './meaning.js';
import { paletteOf } from './resolve.js';

const themesRefusal = (themes: ThemeEntries): string | null => {
  for (const [id, theme] of Object.entries(themes))
    for (const mode of THEME_MODES) {
      const variant = theme[mode];
      if (variant === undefined) continue;
      const refused = meaningRefusal(paletteOf(variant, mode));
      if (refused !== null) return `the theme ${id}, ${mode}: ${refused}`;
    }
  return null;
};

export const THEMES_FACE: PluginFace<ThemeEntries> = {
  name: 'themes',
  title: 'Themes for how Tagma looks',
  schema: ThemeEntries,
  refuses: themesRefusal,
};
