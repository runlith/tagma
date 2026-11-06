import LayoutPanelLeft from '@lucide/svelte/icons/layout-panel-left';
import type { SettingsSection } from '$lib/features/settings/section.js';
import Section from './Section.svelte';

export const sections: readonly SettingsSection[] = [
  {
    id: 'shell',
    group: 'interface',
    order: 3,
    icon: LayoutPanelLeft,
    view: Section,
    hosts: ['tab', 'mobile'],
    place: 'This browser',
    local: {
      title: 'Layout',
      description: 'Remembered by this browser. Choosing reloads the page.',
    },
  },
];
