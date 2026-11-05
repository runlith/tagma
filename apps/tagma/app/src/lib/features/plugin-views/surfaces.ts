import Puzzle from '@lucide/svelte/icons/puzzle';
import { CONTRIBUTED_ROUTE, type SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import SectionPath from './SectionPath.svelte';

export const PLUGIN_SECTION_SURFACE = 'plugin-section';

export const sectionSurface = (plugin: string, view: string): string => `${PLUGIN_SECTION_SURFACE}/${plugin}/${view}`;

export const surfaces: readonly SurfaceDeclaration[] = [
  {
    surface: PLUGIN_SECTION_SURFACE,
    route: CONTRIBUTED_ROUTE,
    label: 'Plugin',
    icon: Puzzle,
    stands: 'project',
    remembers: false,
    nested: true,
    payload: { component: SectionPath },
  },
];
