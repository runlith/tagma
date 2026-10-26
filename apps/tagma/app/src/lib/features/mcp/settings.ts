import Plug from '@lucide/svelte/icons/plug';
import Section from '$lib/features/mcp/Section.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'mcp', group: 'agent', order: 4, icon: Plug, view: Section }];
