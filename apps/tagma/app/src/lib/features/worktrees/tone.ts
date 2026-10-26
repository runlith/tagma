import type { WorktreePlace, WorktreeState } from '@tagma/server/worktrees/contract/wire/rows';

export function toneOf(row: Pick<WorktreePlace, 'hue'> | null): string | null {
  return row === null || row.hue === null ? null : `var(--worktree-${row.hue})`;
}

export const STATUS_WORDS: Record<WorktreeState, { readonly word: string; readonly ink: string }> = {
  missing: { word: 'missing', ink: 'text-destructive' },
  conflicts: { word: 'conflicts', ink: 'text-destructive' },
  waiting: { word: 'waiting', ink: 'text-status-open' },
  working: { word: 'working', ink: 'text-status-in-work' },
  ready: { word: 'ready', ink: 'text-status-done' },
  behind: { word: 'behind', ink: 'text-status-stale' },
  merged: { word: 'merged', ink: 'text-muted-foreground' },
  idle: { word: 'idle', ink: 'text-muted-foreground/70' },
  reading: { word: 'reading…', ink: 'text-muted-foreground/70' },
  unread: { word: 'unreadable', ink: 'text-destructive' },
};
