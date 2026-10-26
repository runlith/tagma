import History from '@lucide/svelte/icons/history';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'activity', group: 'machine', order: 8, icon: History }];
