import { Context } from 'effect';

export const WORKTREE_HOME = 'worktrees';

export class WorktreeHome extends Context.Service<WorktreeHome, { readonly path: string }>()('tagma/worktrees/WorktreeHome') {}
