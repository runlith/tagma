import Monitor from '@lucide/svelte/icons/monitor';
import Moon from '@lucide/svelte/icons/moon';
import Palette from '@lucide/svelte/icons/palette';
import Sun from '@lucide/svelte/icons/sun';
import { APPEARANCE_MODES, type AppearanceMode, MODE_LABELS } from '@tagma/server/appearance/contract/wire/settings';
import type { Component } from 'svelte';
import type { Action } from '$lib/features/workspace/action.js';
import type { Appearance, ThemeEntry } from './Appearance.svelte.js';

const KEYWORDS = ['theme', 'appearance', 'look', 'colour', 'color', 'dark mode', 'light mode'];

const ICONS: { readonly [M in AppearanceMode]: Component<{ class?: string }> } = { system: Monitor, light: Sun, dark: Moon };

const themed = (appearance: Appearance, entry: ThemeEntry): Action => ({
  id: `appearance.theme.${entry.id}`,
  order: 40,
  title: `Theme: ${entry.title}`,
  keywords: KEYWORDS,
  icon: Palette,
  note: () => (appearance.chosen === entry.id ? 'current' : null),
  run: () => appearance.chooseTheme(entry.id),
});

const moded = (appearance: Appearance, mode: AppearanceMode): Action => ({
  id: `appearance.mode.${mode}`,
  order: 41,
  title: `Appearance: ${MODE_LABELS[mode]}`,
  keywords: KEYWORDS,
  icon: ICONS[mode],
  note: () => (appearance.choice === mode ? 'current' : null),
  run: () => appearance.chooseMode(mode),
});

export const actionsOf = (appearance: Appearance): readonly Action[] => [
  ...appearance.themes.map((entry) => themed(appearance, entry)),
  ...APPEARANCE_MODES.map((mode) => moded(appearance, mode)),
];
