import type { WorktreePlace, WorktreeRow, WorktreeState } from '@tagma/server/worktrees/contract/wire/rows';

export type Step = 'merge' | 'update' | 'delete' | 'stop';

export function stateOf(place: WorktreePlace, facts: WorktreeRow | null): WorktreeState | null {
  if (place.missing) return 'missing';
  if (facts?.status === 'conflicts') return 'conflicts';
  if (place.agents.waiting > 0) return 'waiting';
  if (place.agents.working > 0) return 'working';
  if (facts === null || facts.status === 'waiting' || facts.status === 'working') return null;
  return facts.status;
}

export function stepOf(place: WorktreePlace, facts: WorktreeRow | null): Step | null {
  if (place.kind !== 'tagma') return null;
  if (place.missing) return 'delete';
  if (place.pending?.state === 'waiting') return 'stop';
  if (place.base?.branch == null) return null;
  switch (stateOf(place, facts)) {
    case 'ready':
      return 'merge';
    case 'conflicts':
    case 'behind':
      return 'update';
    case 'merged':
      return 'delete';
    default:
      return null;
  }
}
