import Puzzle from '@lucide/svelte/icons/puzzle';
import type { PluginViewSet } from '@tagma/server/views/contract/wire/sets';
import { CONTRIBUTED_ROUTE, type SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import SectionPath from './SectionPath.svelte';
import { sectionPath } from './sectionPath.js';
import { PLUGIN_SECTION_SURFACE, sectionSurface } from './surfaces.js';

const RAIL_FROM = 100;

export const sectionDeclarations = (sets: readonly PluginViewSet[]): readonly SurfaceDeclaration[] =>
  sets
    .flatMap((set) => set.surfaces.map((section) => ({ set, section })))
    .map(({ set, section }, place): SurfaceDeclaration => ({
      surface: sectionSurface(set.plugin, section.view),
      within: PLUGIN_SECTION_SURFACE,
      route: `${CONTRIBUTED_ROUTE}/${sectionPath(set.plugin, section.view)}`,
      payload: { component: SectionPath },
      label: section.title,
      icon: Puzzle,
      iconUrl: section.icon ?? undefined,
      rail: RAIL_FROM + place,
      stands: 'project',
      remembers: false,
    }));
