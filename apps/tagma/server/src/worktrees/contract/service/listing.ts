import { Context, type Effect, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { WorktreeFeedEvent, WorktreeListAnswer, WorktreeRow, WorktreeWindow } from '../wire/rows.js';

export type ProjectMoved = (listener: (projectId: number) => void) => () => void;

export class WorktreeHeld extends Context.Service<
  WorktreeHeld,
  {
    held(): ReadonlySet<string>;
    readonly moved: ProjectMoved;
  }
>()('tagma/worktrees/WorktreeHeld') {}

export const WORKTREE_ROW_REFUSALS = [
  'worktree-unavailable',
  'coverage-unestablished',
  'coverage-moved',
  'coverage-registry',
  'coverage-foreign-namespace',
  'root-missing',
  'root-unavailable',
  'root-replaced',
  'root-inconclusive',
  'repository-missing',
  'repository-moved',
  'repository-replaced',
  'repository-inconclusive',
  'repository-unavailable',
  'repository-unborn',
] as const;
export type WorktreeRowRefusal = (typeof WORKTREE_ROW_REFUSALS)[number];

export const WORKTREE_ROWS_REFUSALS = ['bad-cursor', 'cursor-stale', ...WORKTREE_ROW_REFUSALS] as const;
export type WorktreeRowsRefusal = (typeof WORKTREE_ROWS_REFUSALS)[number];

export class WorktreeRows extends Context.Service<
  WorktreeRows,
  {
    list(
      projectId: number,
      asked: { readonly limit?: number; readonly cursor?: string },
    ): Effect.Effect<WorktreeListAnswer, GateRefusal<WorktreeRowsRefusal>>;
    rows(projectId: number): Effect.Effect<readonly WorktreeRow[], GateRefusal<WorktreeRowRefusal>>;
    subscribe(projectId: number, window: WorktreeWindow): Stream.Stream<WorktreeFeedEvent, GateRefusal<WorktreeRowsRefusal>>;
  }
>()('tagma/worktrees/WorktreeRows') {}
