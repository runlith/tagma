import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { Actions } from '$lib/features/workspace/action.js';
import { actions } from './actions.js';
import { Cleanup } from './Cleanup.svelte.js';
import { Finishing } from './Finishing.svelte.js';
import { Worktrees } from './BoardState.svelte.js';
import { WorktreesRepo } from './Repo.js';
import { sections } from './settings.js';

export const WorktreesLayer = Layer.mergeAll(
  SettingSections.contribute('worktrees', ...sections),
  Actions.contribute('worktrees', { id: 'worktrees', area: 'Worktrees', actions }),
  WorktreesRepo,
  Worktrees,
  Finishing,
  Cleanup,
);
