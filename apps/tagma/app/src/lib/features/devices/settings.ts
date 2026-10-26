import Smartphone from '@lucide/svelte/icons/smartphone';
import type { SettingsSection } from '$lib/features/settings/section.js';
import Section from './Section.svelte';

export const sections: readonly SettingsSection[] = [
  { id: 'remote', group: 'machine', order: 6, icon: Smartphone, view: Section, standalone: true, place: 'This machine' },
];
