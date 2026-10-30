import Blocks from '@lucide/svelte/icons/blocks';
import type { SurfacesModule } from '$lib/features/workspace/surface.js';
import { PLUGINS } from './place.js';
import WaitsMark from './WaitsMark.svelte';

export const surfaces: SurfacesModule['surfaces'] = [
  {
    surface: PLUGINS,
    route: 'plugins',
    label: 'Plugins',
    icon: Blocks,
    mark: WaitsMark,
    rail: 45,
    stands: 'project',
    remembers: true,
  },
];
