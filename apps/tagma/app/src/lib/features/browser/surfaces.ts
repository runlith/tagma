import Globe from '@lucide/svelte/icons/globe';
import type { SurfacesModule } from '$lib/features/workspace/surface.js';

export const BROWSER_SURFACE = 'browser';

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: BROWSER_SURFACE,
    route: 'w',
    label: 'Pages',
    icon: Globe,
    stands: 'project',
    remembers: false,
    phone: true,
  },
];
