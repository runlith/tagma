import Puzzle from '@lucide/svelte/icons/puzzle';
import SettingsSection from '$lib/features/tagma-apps/SettingsSection.svelte';
import type { SettingsSection as Section } from '$lib/features/settings/section.js';

export const sections: readonly Section[] = [{ id: 'apps', group: 'agent', order: 5, icon: Puzzle, view: SettingsSection }];
