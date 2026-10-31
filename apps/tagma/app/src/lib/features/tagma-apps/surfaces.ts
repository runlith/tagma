import Puzzle from '@lucide/svelte/icons/puzzle';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';

export const TAGMA_APP_SURFACE = 'app';

export const sectionSurface = (tagmaApp: string, view: string): string => `${TAGMA_APP_SURFACE}/${tagmaApp}/${view}`;

export const surfaces: readonly SurfaceDeclaration[] = [
  {
    surface: TAGMA_APP_SURFACE,
    formerly: 'plugin',
    route: 'p',
    label: 'App',
    icon: Puzzle,
    stands: 'project',
    remembers: false,
    nested: true,
  },
];
