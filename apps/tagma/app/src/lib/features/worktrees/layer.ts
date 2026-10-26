import { Layer } from '@runlith/layer/Layer';
import { Cleanup } from './Cleanup.svelte.js';
import { Finishing } from './Finishing.svelte.js';
import { Worktrees } from './BoardState.svelte.js';
import { WorktreesRepo } from './Repo.js';

export const WorktreesLayer = Layer.mergeAll(WorktreesRepo, Worktrees, Finishing, Cleanup);
