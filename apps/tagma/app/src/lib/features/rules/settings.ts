import Globe from '@lucide/svelte/icons/globe';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [
  { id: 'rules', group: 'project', order: 3, icon: Globe },
  { id: 'enforcement', group: 'project', order: 5, icon: ShieldCheck },
];
