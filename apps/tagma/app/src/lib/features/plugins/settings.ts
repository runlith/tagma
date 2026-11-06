import Package from '@lucide/svelte/icons/package';
import AddProvider from '$lib/features/plugins/AddProvider.svelte';
import Section from '$lib/features/plugins/Section.svelte';
import type { SectionContribution, SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'plugins', group: 'agent', order: 6, icon: Package, view: Section }];

export const contributions: readonly SectionContribution[] = [
  { id: 'plugins-add-provider', section: 'providers', order: 1, payload: { component: AddProvider } },
];
