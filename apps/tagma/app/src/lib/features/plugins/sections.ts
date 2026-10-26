import Puzzle from '@lucide/svelte/icons/puzzle';
import type { PluginViewSet } from '@tagma/server/views/contract/wire/sets';
import type { SurfaceDeclaration } from '$lib/features/workspace/surface.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { PaletteAction } from '$lib/features/workspace/action.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { PLUGIN_PANE, pluginPaneId } from './panes.js';
import { sectionSurface } from './surfaces.js';

const RAIL_FROM = 100;

export const sectionActions = (sets: readonly PluginViewSet[]): readonly PaletteAction[] =>
  sets.flatMap((set) => [
    ...set.surfaces.map((section): PaletteAction => ({
      id: `plugin.${set.plugin}.section.${section.view}`,
      order: 70,
      title: `Go to ${section.title}`,
      keywords: ['open', 'navigate', 'section', set.title],
      icon: Puzzle,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).revealSurface(sectionSurface(set.plugin, section.view)),
    })),
    ...set.panes.map((pane): PaletteAction => ({
      id: `plugin.${set.plugin}.pane.${pane.view}`,
      order: 71,
      title: `Open ${pane.title} beside`,
      keywords: ['pane', 'side', 'beside', set.title],
      icon: Puzzle,
      available: (env) => env.project !== null,
      run: (env) => shellActs(env.resolve(ShellOps), env.resolve(Notices)).openPane(PLUGIN_PANE, pluginPaneId(set.plugin, pane.view)),
    })),
  ]);

export const sectionDeclarations = (sets: readonly PluginViewSet[]): readonly SurfaceDeclaration[] =>
  sets
    .flatMap((set) => set.surfaces.map((section) => ({ set, section })))
    .map(({ set, section }, place): SurfaceDeclaration => ({
      surface: sectionSurface(set.plugin, section.view),
      route: `p/${set.plugin}/${section.view}`,
      label: section.title,
      icon: Puzzle,
      iconUrl: section.icon === undefined || set.site._tag !== 'served' ? undefined : new URL(section.icon, `${set.site.origin}/`).href,
      rail: RAIL_FROM + place,
      stands: 'project',
      remembers: false,
    }));
