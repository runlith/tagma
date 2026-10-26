import Puzzle from '@lucide/svelte/icons/puzzle';
import type { SurfacesModule } from '$lib/features/workspace/surface.js';

export const PLUGIN_SURFACE = 'plugin';

export const sectionSurface = (plugin: string, view: string): string => `${PLUGIN_SURFACE}/${plugin}/${view}`;

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: PLUGIN_SURFACE,
    route: 'p',
    label: 'Plugin',
    icon: Puzzle,
    stands: 'project',
    remembers: false,
    nested: true,
  },
];
