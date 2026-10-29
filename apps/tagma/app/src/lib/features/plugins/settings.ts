import Package from '@lucide/svelte/icons/package';
import Section from '$lib/features/plugins/Section.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'plugins', group: 'agent', order: 6, icon: Package, view: Section }];
