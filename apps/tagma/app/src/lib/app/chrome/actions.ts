import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';
import FolderMinus from '@lucide/svelte/icons/folder-minus';
import FolderPlus from '@lucide/svelte/icons/folder-plus';
import Monitor from '@lucide/svelte/icons/monitor';
import Moon from '@lucide/svelte/icons/moon';
import PanelLeft from '@lucide/svelte/icons/panel-left';
import Sun from '@lucide/svelte/icons/sun';
import type { Component } from 'svelte';
import { labelOf } from '$lib/features/workspace/mark.js';
import { ProjectRemoval } from '$lib/features/projects/Removal.svelte.js';
import type { ActionsModule, PaletteAction } from '$lib/features/workspace/action.js';
import { Theme, type ThemeChoice } from '$lib/shared/Theme.svelte.js';
import { ColumnRegistry } from './ColumnRegistry.js';
import { ProjectCreation } from './ProjectCreation.svelte.js';
import { Standing } from './Standing.svelte.js';

const pick = (choice: ThemeChoice, title: string, icon: Component<{ class?: string }>): PaletteAction => ({
  id: `theme.${choice}`,
  order: 40,
  title,
  keywords: ['theme', 'appearance', 'colour', 'color', 'dark mode', 'light mode'],
  icon,
  note: (env) => (env.resolve(Theme).choice === choice ? 'current' : null),
  run: (env) => env.resolve(Theme).choose(choice),
});

const update: PaletteAction = {
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

export const actions: ActionsModule['actions'] = [
  {
    id: 'column.toggle',
    order: 30,
    title: 'Toggle column',
    keywords: ['sidebar', 'index', 'panel', 'hide', 'show'],
    icon: PanelLeft,
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
  pick('system', 'Theme: System', Monitor),
  pick('light', 'Theme: Light', Sun),
  pick('dark', 'Theme: Dark', Moon),
  update,
];
