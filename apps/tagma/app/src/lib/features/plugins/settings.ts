import Puzzle from '@lucide/svelte/icons/puzzle';
import SettingsSection from '$lib/features/plugins/SettingsSection.svelte';
import type { SettingsSection as Section } from '$lib/features/settings/section.js';

export const sections: readonly Section[] = [{ id: 'plugins', group: 'agent', order: 5, icon: Puzzle, view: SettingsSection }];
