import type { PoolDeclaration } from '@runlith/held/Capacity';
import { figures, type Machine } from '../platform/contract/service/capacity.js';

export const MERGE_CHECKS = 'worktree-merge-checks';
export const WORKTREE_READS = 'worktree-reads';

const GIB = 1024 ** 3;

export const pools = (machine: Machine): readonly PoolDeclaration[] => {
  const budget = figures(machine);
  const units = Math.max(1, Math.min(Math.floor(budget.heavySlots / 2), Math.floor(budget.serverMemory / GIB)));
  const limits = { call: units, background: Math.max(1, units - 1) };
  const reads = Math.min(2, units);
  return [
    { name: MERGE_CHECKS, units, limits },
    { name: WORKTREE_READS, units: reads, limits: { call: reads, background: 1 } },
  ];
};
