import Palette from '@lucide/svelte/icons/palette';
import type { SectionContribution, SettingsSection } from '$lib/features/settings/section.js';
import ThemeChoice from './ThemeChoice.svelte';

export const sections: readonly SettingsSection[] = [{ id: 'appearance', group: 'interface', order: 1, icon: Palette }];

export const contributions: readonly SectionContribution[] = [
  { id: 'appearance-theme', section: 'appearance', order: 1, payload: { component: ThemeChoice } },
];
