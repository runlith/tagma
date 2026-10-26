import Mic from '@lucide/svelte/icons/mic';
import Section from '$lib/features/speech/Section.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'speech', group: 'machine', order: 5, icon: Mic, view: Section }];
