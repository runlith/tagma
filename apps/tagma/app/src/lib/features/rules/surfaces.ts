import type { SurfacesModule } from '$lib/features/workspace/surface.js';
import RulesIcon from './RulesIcon.svelte';

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: 'rules',
    route: 'rules',
    label: 'Rules',
    icon: RulesIcon,
    rail: 40,
    stands: 'graph',
    remembers: true,
  },
];
