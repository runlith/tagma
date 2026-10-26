import KeyRound from '@lucide/svelte/icons/key-round';
import AuthSection from '$lib/features/providers/AuthSection.svelte';
import type { SettingsSection } from '$lib/features/settings/section.js';

export const sections: readonly SettingsSection[] = [
  {
    id: 'providers',
    group: 'machine',
    order: 1,
    icon: KeyRound,
    view: AuthSection,
    standalone: true,
    place: 'This machine',
    local: {
      title: 'Providers',
      description: 'Choose how each provider signs in and manage its accounts on this machine.',
    },
  },
];
