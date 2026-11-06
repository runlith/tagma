import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';
import { TAGMA_THEME } from './format.js';

export const APPEARANCE_SETTING_SECTIONS = [
  {
    id: 'appearance',
    order: 20,
    title: 'Appearance',
    description: 'How Tagma looks for you on every device: the theme, light or dark, and the status bar.',
  },
] as const;

export const APPEARANCE_MODES = ['system', 'light', 'dark'] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const MODE_LABELS: { readonly [M in AppearanceMode]: string } = { system: 'Same as the system', light: 'Light', dark: 'Dark' };

const MODE_HINTS: { readonly [M in AppearanceMode]: string } = {
  system: 'Each device follows its own light or dark setting.',
  light: 'Light on every device.',
  dark: 'Dark on every device.',
};

export const appearanceTheme = settingKey({
  id: 'appearance.theme',
  order: 1,
  title: 'Theme',
  description:
    'The theme every window of yours paints: `tagma`, or `<plugin>.<theme>` of a theme an enabled plugin brings. A theme no longer offered paints Tagma until its plugin is on again.',
  schema: Schema.String.check(Schema.isPattern(/^(?:tagma|[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/u)),
  control: { kind: 'catalog', of: 'theme' },
  fallback: TAGMA_THEME,
  scopes: ['user'],
  merge: 'replace',
});

export const appearanceMode = settingKey<AppearanceMode, 'appearance.mode'>({
  id: 'appearance.mode',
  order: 2,
  title: 'Light or dark',
  description: 'Light, dark, or the same as each device’s own system setting. A theme that comes in one look only shows that look.',
  schema: Schema.Literals(APPEARANCE_MODES),
  control: {
    kind: 'choice',
    choices: APPEARANCE_MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode], hint: MODE_HINTS[mode] })),
  },
  fallback: 'system',
  scopes: ['user'],
  merge: 'replace',
});

export const APPEARANCE_SETTINGS = [appearanceTheme, appearanceMode] as const;
