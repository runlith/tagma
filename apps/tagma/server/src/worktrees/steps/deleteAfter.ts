import type { ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { WORKTREE_ENTRY } from '../contract/wire/entries.js';

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const deletedAfterForm: ThreadFormStep = {
  name: '20261013170000_worktree_delete_after',
  samples: { entry: { type: WORKTREE_ENTRY, event: 'merged', after: { act: 'archive', outcome: 'done', reason: null } } },
  entry: (entry) => {
    if (entry.type !== WORKTREE_ENTRY || entry.event !== 'merged' || !object(entry.after) || entry.after.act !== 'archive') return null;
    return { ...entry, after: { ...entry.after, act: 'delete' } };
  },
};
