import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { Action, ActionEnv, ActionList } from '$lib/features/workspace/action.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { ShellOps, shellActs } from '$lib/features/workspace/ShellOps.js';
import { FIRST_PLACES } from './keys.js';
import { ProjectStrip } from './Strip.svelte.js';

const LAST = 'project.last';

const placeId = (place: number): string => `project.place-${place}`;

export const placeAction = (index: number, count: number): string | null =>
  index < FIRST_PLACES ? placeId(index + 1) : index === count - 1 ? LAST : null;

const goTo = (env: ActionEnv, tile: Project | undefined): void => {
  const strip = env.resolve(ProjectStrip);
  if (tile === undefined || tile.id === env.resolve(Workspace).activeTileId) return;
  void shellActs(env.resolve(ShellOps), env.resolve(Notices)).openProject(strip.entry(tile).id, 'keys');
};

const place = (n: number): Action => ({
  id: placeId(n),
  title: `Go to project ${n} in the dock`,
  palette: false,
  keys: { mac: [`Mod+${n}`], other: [] },
  tabKeys: [],
  available: (env) => env.resolve(ProjectStrip).projects.length >= n,
  run: (env) => goTo(env, env.resolve(ProjectStrip).projects[n - 1]),
});

export const actions: ActionList = [
  ...Array.from({ length: FIRST_PLACES }, (_, index) => place(index + 1)),
  {
    id: LAST,
    title: 'Go to the last project in the dock',
    palette: false,
    keys: { mac: [`Mod+${FIRST_PLACES + 1}`], other: [] },
    tabKeys: [],
    available: (env) => env.resolve(ProjectStrip).projects.length > 0,
    run: (env) => goTo(env, env.resolve(ProjectStrip).projects.at(-1)),
  },
];
