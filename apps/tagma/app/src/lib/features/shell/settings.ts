import LayoutPanelLeft from '@lucide/svelte/icons/layout-panel-left';
import Palette from '@lucide/svelte/icons/palette';
import type { SettingsSection } from '$lib/features/settings/section.js';
import Section from './Section.svelte';

export const sections: readonly SettingsSection[] = [
  { id: 'appearance', group: 'interface', order: 1, icon: Palette },
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
