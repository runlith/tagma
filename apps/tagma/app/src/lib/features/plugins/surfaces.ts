import Blocks from '@lucide/svelte/icons/blocks';
import type { SurfacesModule } from '$lib/features/workspace/surface.js';
import { PLUGINS } from './place.js';

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: PLUGINS,
    route: 'plugins',
    label: 'Plugins',
    icon: Blocks,
    rail: 45,
    stands: 'project',
    remembers: true,
  },
];
