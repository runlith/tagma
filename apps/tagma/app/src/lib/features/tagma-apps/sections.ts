import Puzzle from '@lucide/svelte/icons/puzzle';
import type { TagmaAppViewSet } from '@tagma/server/views/contract/wire/sets';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { PaletteAction } from '$lib/features/workspace/action.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { paneId, TAGMA_APP_PANE } from './panes.js';
import { sectionSurface } from './surfaces.js';

const RAIL_FROM = 100;

export const sectionActions = (sets: readonly TagmaAppViewSet[]): readonly PaletteAction[] =>
  sets.flatMap((set) => [
    ...set.surfaces.map((section): PaletteAction => ({
      id: `app.${set.app}.section.${section.view}`,
      order: 70,
      title: `Go to ${section.title}`,
      keywords: ['open', 'navigate', 'section', set.title],
      icon: Puzzle,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).revealSurface(sectionSurface(set.app, section.view)),
    })),
    ...set.panes.map((pane): PaletteAction => ({
      id: `app.${set.app}.pane.${pane.view}`,
      order: 71,
      title: `Open ${pane.title} beside`,
      keywords: ['pane', 'side', 'beside', set.title],
      icon: Puzzle,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).openPane(TAGMA_APP_PANE, paneId(set.app, pane.view)),
    })),
  ]);

export const sectionDeclarations = (sets: readonly TagmaAppViewSet[]): readonly SurfaceDeclaration[] =>
  sets
    .flatMap((set) => set.surfaces.map((section) => ({ set, section })))
    .map(({ set, section }, place): SurfaceDeclaration => ({
      surface: sectionSurface(set.app, section.view),
      route: `p/${set.app}/${section.view}`,
      label: section.title,
      icon: Puzzle,
      iconUrl: section.icon === undefined || set.site._tag !== 'served' ? undefined : new URL(section.icon, `${set.site.origin}/`).href,
      rail: RAIL_FROM + place,
      stands: 'project',
      remembers: false,
    }));
