import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
import FolderMinus from '@lucide/svelte/icons/folder-minus';
import FolderPlus from '@lucide/svelte/icons/folder-plus';
import PanelLeft from '@lucide/svelte/icons/panel-left';
import { labelOf } from '$lib/features/workspace/mark.js';
import { ProjectRemoval } from '$lib/features/projects/Removal.svelte.js';
import type { Action, ActionList } from '$lib/features/workspace/action.js';
import { DesktopTabs } from '$lib/shared/desktop/DesktopTabs.js';
import { Host } from '@runlith/layer/Host';
import { Overlay } from '@runlith/primitives/Overlay.svelte';
import { Palette } from '../panes/palette.js';
import { SidePanes } from '../panes/SidePanes.svelte.js';
import { ColumnRegistry } from './ColumnRegistry.js';
import { ProjectCreation } from './ProjectCreation.svelte.js';
import { Standing } from './Standing.svelte.js';

const togglePalette = (overlay: Overlay, group?: 'files'): void => {
  if (overlay.isOpen(Palette)) overlay.close(Palette);
  else overlay.open(Palette, group === undefined ? {} : { group });
};

const keys: readonly Action[] = [
  {
    id: 'palette.open',
    title: 'Find or ask',
    palette: false,
    keys: ['Mod+K'],
    run: (env) => togglePalette(env.resolve(Overlay)),
  },
  {
    id: 'palette.files',
    title: 'Go to a file',
    palette: false,
    keys: ['Mod+P'],
    available: (env) => env.routeProject !== null,
    run: (env) => togglePalette(env.resolve(Overlay), 'files'),
  },
  {
    id: 'area.toggle',
    order: 31,
    title: 'Show or hide the right area',
    keywords: ['pane', 'side', 'beside', 'panel', 'hide', 'show'],
    keys: ['Mod+Alt+Backslash'],
    available: (env) => env.routeProject !== null && env.resolve(SidePanes).panes.length > 0,
    run: (env) => {
      const panes = env.resolve(SidePanes);
      panes.showArea(!panes.showing);
    },
  },
  {
    id: 'tab.close',
    title: 'Close the focused tab',
    palette: false,
    keys: ['Mod+W'],
    tabKeys: [],
    available: (env) => env.resolve(Host).isDesktop,
    run: (env) => {
      const panes = env.resolve(SidePanes);
      const beside = panes.focus;
      if (beside !== null) return void panes.close(beside);
      const shown = panes.showing ? panes.active : null;
      if (shown !== null) return void panes.close(shown.key);
      env.resolve(DesktopTabs).closeWindow();
    },
  },
  { id: 'tab.reopen', title: 'Reopen the closed tab', palette: false, keys: ['Mod+Shift+T'], tabKeys: [], run: () => undefined },
  { id: 'tagma.hide', title: 'Hide and show Tagma', keys: [{ keys: 'Mod+Shift+L', global: true }], tabKeys: [] },
];

const update: Action = {
  id: 'tagma.update',
  order: 90,
  title: 'Update Tagma',
  keywords: ['upgrade', 'install', 'build', 'restart', 'server'],
  icon: CircleArrowUp,
  available: (env) => env.resolve(Standing).upcoming !== null,
  disabled: (env) => {
    const standing = env.resolve(Standing);
    return standing.acting !== null || (standing.next?.installing ?? null) !== null || standing.upcoming?.disabled !== null;
  },
  note: (env) => {
    const upcoming = env.resolve(Standing).upcoming;
    return upcoming === null ? null : `${upcoming.title} · ${upcoming.update}`;
  },
  run: (env) => {
    const standing = env.resolve(Standing);
    const upcoming = standing.upcoming;
    if (upcoming !== null) return standing.update(upcoming.id);
  },
};

export const actions: ActionList = [
  ...keys,
  {
    id: 'column.toggle',
    order: 30,
    title: 'Toggle column',
    keywords: ['sidebar', 'index', 'panel', 'hide', 'show'],
    icon: PanelLeft,
    keys: ['Mod+Backslash'],
    available: (env) => env.surface !== null && env.resolve(ColumnRegistry).of(env.surface, env) !== null,
    note: (env) => (env.surface === null ? null : (env.resolve(ColumnRegistry).of(env.surface, env)?.label ?? null)),
    run: (env) => {
      if (env.surface !== null) env.resolve(ColumnRegistry).of(env.surface, env)?.toggle();
    },
  },
  {
    id: 'project.new',
    order: 27,
    title: 'New project',
    keywords: ['register', 'add', 'folder', 'repository'],
    icon: FolderPlus,
    run: (env) => {
      env.resolve(ProjectCreation).open = true;
    },
  },
  {
    id: 'project.remove',
    order: 28,
    title: 'Remove project from Tagma',
    keywords: ['remove', 'close', 'unregister', 'forget', 'project'],
    icon: FolderMinus,
    available: (env) => env.project !== null && env.project.kind === 'folder',
    note: (env) => (env.project === null ? null : labelOf(env.project)),
    run: (env) => {
      if (env.project !== null) env.resolve(ProjectRemoval).ask(env.project);
    },
  },
  update,
];
