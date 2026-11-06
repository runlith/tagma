import Keyboard from '@lucide/svelte/icons/keyboard';
import type { SettingsSection } from '$lib/features/settings/section.js';
import Section from './Section.svelte';

export const sections: readonly SettingsSection[] = [
  { id: 'shortcuts', group: 'interface', order: 2, icon: Keyboard, view: Section, keys: ['shortcuts.bindings'] },
];
