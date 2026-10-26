import { expect, test } from 'bun:test';
import { judge } from '@runlith/agent/modes/ApprovalMode';
import { builtinModeRegistry } from '@runlith/agent/modes/ApprovalModes';
import { FOLDER_DIRTY, RETIREMENT_OPERATIONS } from '../worktrees/contract/wire/operations/retirement.js';

const modes = builtinModeRegistry();
const { approval } = RETIREMENT_OPERATIONS.delete_worktree;
const dirty = [{ condition: FOLDER_DIRTY.id, fact: '2 uncommitted paths are committed onto the branch' }];

const asked = (mode: string, raised: typeof dirty | []) => {
  const outcome = judge(approval, raised, modes.find(mode)!, modes, { toolName: 'delete_worktree', mutating: true });
  return outcome.verdict === 'ask' ? outcome.reasons.map((reason) => reason.id) : outcome.verdict;
};

test('deleting a worktree asks nothing in bypass, asks in trust only over uncommitted files, and asks review one question that names them', () => {
  expect([asked('bypass', []), asked('bypass', dirty)]).toEqual(['allow', 'allow']);
  expect([asked('trust', []), asked('trust', dirty)]).toEqual(['allow', [FOLDER_DIRTY.id]]);
  expect(asked('review', dirty)).toEqual(['review', FOLDER_DIRTY.id]);
});
