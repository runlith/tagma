import Globe from '@lucide/svelte/icons/globe';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';

const BROWSER_SURFACE = 'browser';

export const surfaces: readonly SurfaceDeclaration[] = [
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
