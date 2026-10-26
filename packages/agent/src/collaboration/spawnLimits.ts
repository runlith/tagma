import type { ThreadBudgetReading } from '../thread/ThreadPorts';
import type { PlaneRefusalCode } from './refusals';
import type { ThreadDelegation } from './CollaborationConfig';
import { delegationRefused } from './CollaborationVoice';
import type { ThreadSpawnDepth } from './ThreadSpawnAccess';

export type SpawnCeilings = {
  readonly parentId: string;
  readonly delegation: ThreadDelegation | null;
  readonly depth: ThreadSpawnDepth | null;
  readonly budget: ThreadBudgetReading | null;
  readonly slots: number | undefined;
};

export type SpawnLimitReading = SpawnCeilings & { readonly resident: number };

const unmeasured = (budget: ThreadBudgetReading): string =>
  budget.unmeasuredCount === 0
    ? ''
    : ` ${budget.unmeasuredCount} of its threads report no spend (${budget.unmeasuredSample.join(', ')}), so none is claimed against the allowance.`;

export type SpawnLimit = {
  readonly code: Extract<PlaneRefusalCode, 'delegation-off' | 'depth-exhausted' | 'budget-spent' | 'spawn-slots-full'>;
  readonly fact: string;
};

export const spawnLimits = ({ parentId, delegation, depth, budget, slots, resident }: SpawnLimitReading): readonly SpawnLimit[] => [
  ...(delegation === null || delegation.allowed
    ? []
    : [{ code: 'delegation-off' as const, fact: delegationRefused(parentId, delegation) }]),
  ...(depth === null || depth.remaining > 0
    ? []
    : [
        {
          code: 'depth-exhausted' as const,
          fact: `Sub-agent depth ${depth.maximum} is exhausted at thread ${parentId}; the child stands below it.`,
        },
      ]),
  ...(budget === null || budget.remaining === null || budget.remaining > 0
    ? []
    : [
        {
          code: 'budget-spent' as const,
          fact: `This agent tree has spent its budget of ${budget.allowed} tokens, and the child spends past it.${unmeasured(budget)}`,
        },
      ]),
  ...(slots === undefined || resident < slots
    ? []
    : [
        {
          code: 'spawn-slots-full' as const,
          fact: `This host runs ${slots} spawned agents at once and all ${slots} are working; the child runs beside them.`,
        },
      ]),
];
