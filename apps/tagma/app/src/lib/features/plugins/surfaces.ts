import Blocks from '@lucide/svelte/icons/blocks';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import { PLUGINS } from './place.js';
import WaitsMark from './WaitsMark.svelte';

export const surfaces: readonly SurfaceDeclaration[] = [
  {
    surface: PLUGINS,
    route: 'plugins',
    label: 'Plugins',
    icon: Blocks,
    mark: WaitsMark,
    rail: 45,
    stands: 'project',
    column: 'plugins',
    remembers: true,
  },
];
