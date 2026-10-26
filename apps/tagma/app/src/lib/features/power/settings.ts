import Coffee from '@lucide/svelte/icons/coffee';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [{ id: 'power', group: 'machine', order: 2, icon: Coffee }];
