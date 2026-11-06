import Monitor from '@lucide/svelte/icons/monitor';
import Moon from '@lucide/svelte/icons/moon';
import Palette from '@lucide/svelte/icons/palette';
import Sun from '@lucide/svelte/icons/sun';
import { TAGMA_THEME } from '@tagma/server/appearance/contract/wire/format';
import type { AppearanceMode } from '@tagma/server/appearance/contract/wire/settings';
import type { Component } from 'svelte';
import type { Action, ActionList } from '$lib/features/workspace/action.js';
import { Appearance } from './Appearance.svelte.js';
import { MODE_LABEL, MODES } from './words.js';

const KEYWORDS = ['theme', 'appearance', 'look', 'colour', 'color', 'dark mode', 'light mode'];

const ICONS: { readonly [M in AppearanceMode]: Component<{ class?: string }> } = { system: Monitor, light: Sun, dark: Moon };

const themed = (id: string, title: string): Action => ({
  id: `appearance.theme.${id}`,
  order: 40,
  title: `Theme: ${title}`,
  keywords: KEYWORDS,
  icon: Palette,
  note: (env) => (env.resolve(Appearance).chosen === id ? 'current' : null),
  run: (env) => env.resolve(Appearance).chooseTheme(id),
});

const moded = (mode: AppearanceMode): Action => ({
  id: `appearance.mode.${mode}`,
  order: 41,
  title: `Appearance: ${MODE_LABEL[mode]}`,
  keywords: KEYWORDS,
  icon: ICONS[mode],
  note: (env) => (env.resolve(Appearance).choice === mode ? 'current' : null),
  run: (env) => env.resolve(Appearance).chooseMode(mode),
});

export const actions: ActionList = (app) => [
  themed(TAGMA_THEME, 'Tagma'),
  ...app.resolve(Appearance).offered.map((offered) => themed(offered.id, offered.theme.title)),
  ...MODES.map(moded),
];
