import Globe from '@lucide/svelte/icons/globe';
import type { SettingsSection } from '$lib/features/settings/section.js';
import Section from './section/Section.svelte';

export const sections: readonly SettingsSection[] = [{ id: 'browser', group: 'machine', order: 7, icon: Globe, view: Section }];
