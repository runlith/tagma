import type { Section } from '../../platform/contract/wire/section.js';

export const branchesAndWorktrees: Section = (ctx) => `## Branches and Worktrees

- The project's main checkout holds the project's main branch — main, release, whatever it is — and stays on it. NEVER switch or re-point the branch of the tree you stand in: other sessions, the operator's editor and every open file read it.
- Work on another branch is a worktree of its own. Asked to work in one, take three acts before any other step: ${ctx.op('prepare_worktree')} resolves it, ${ctx.op('create_worktree')} makes it, named after its branch in the project's worktree folder, and ${ctx.op('move_thread')} stands this thread there. Creating a worktree leaves this thread where it stood: until the move, every command and relative path still runs in the old checkout. Tagma never cuts, merges, finishes or deletes a checkout made with \`git worktree add\`.
- Uncommitted changes reach a branch by being written into its worktree; the files they were taken from are then restored.
`;
