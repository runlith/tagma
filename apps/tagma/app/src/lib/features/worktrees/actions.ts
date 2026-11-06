import GitBranchPlus from '@lucide/svelte/icons/git-branch-plus';
import type { ActionList } from '$lib/features/workspace/action.js';
import { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';

export const actions: ActionList = [
  {
    id: 'worktree.new',
    order: 25,
    title: 'New worktree',
    keywords: ['branch', 'checkout'],
    icon: GitBranchPlus,
    available: (env) => env.routeProject !== null,
    run: (env) => {
      env.resolve(Worktrees).creating = true;
    },
  },
];
