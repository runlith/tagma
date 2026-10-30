import { expect, test } from 'bun:test';
import { askOptions, chosenOption, judgedCall, type PermissionAsk } from './asks.js';
import { builtinHarness } from '../testing/builtin.js';

const ask = (
  toolCall: PermissionAsk['params']['toolCall'],
  kinds: readonly ('allow_once' | 'allow_always' | 'reject_once' | 'reject_always')[],
): PermissionAsk => ({
  kind: 'permission',
  id: 7,
  turn: 'turn-1',
  answer: null,
  uncertain: false,
  params: { sessionId: 's', toolCall, options: kinds.map((kind) => ({ optionId: `${kind}-id`, name: kind, kind })) },
});

test('a call is judged by its kind and the subject its input names, from the earlier tool call when the request carries only its id', () => {
  const bare = ask({ toolCallId: 'exec_1' }, ['allow_once', 'reject_once']);
  expect(
    judgedCall(
      bare,
      { toolCallId: 'exec_1', title: 'Run', kind: 'execute', rawInput: '{"command": "git push"}' },
      true,
      builtinHarness('devin').tools,
    ),
  ).toEqual({
    call: { id: 'exec_1', tool: 'bash', subject: 'git push' },
    mutating: true,
  });
  expect(
    judgedCall(
      ask({ toolCallId: 'r', kind: 'read', locations: [{ path: '/repo/a.ts' }] }, ['allow_once']),
      undefined,
      true,
      builtinHarness('devin').tools,
    ),
  ).toEqual({
    call: { id: 'r', tool: 'read', subject: '/repo/a.ts' },
    mutating: false,
  });
  expect(
    judgedCall(
      ask({ toolCallId: 'mcp', title: 'mcp__tagma__send_message' }, ['allow_once']),
      undefined,
      true,
      builtinHarness('devin').tools,
    ),
  ).toEqual({
    call: { id: 'mcp', tool: 'other', subject: 'mcp__tagma__send_message' },
    mutating: true,
  });
  expect(
    judgedCall(ask({ toolCallId: 'plan', kind: 'switch_mode' }, ['allow_once']), undefined, true, builtinHarness('devin').tools),
  ).toEqual({
    call: { id: 'plan', tool: 'other', subject: 'plan' },
    mutating: true,
  });
});

test('permission requests retain the vendor name from the request or the earlier call without losing mutation evidence', () => {
  const bare = ask({ toolCallId: 'c' }, ['allow_once', 'reject_once']);
  const known = {
    toolCallId: 'c',
    name: 'NotebookEdit',
    title: 'Edit notebook',
    kind: 'edit' as const,
    rawInput: { path: '/repo/a.ipynb' },
  };
  expect(judgedCall(bare, known, false, builtinHarness('claude-code').tools)).toEqual({
    call: { id: 'c', tool: 'NotebookEdit', subject: '/repo/a.ipynb' },
    mutating: true,
  });
  expect(judgedCall(ask({ toolCallId: 'c', name: 'apply_patch' }, ['allow_once']), known, true, builtinHarness('codex').tools)).toEqual({
    call: { id: 'c', tool: 'apply_patch', subject: '/repo/a.ipynb' },
    mutating: true,
  });
  expect(judgedCall(bare, known, false, builtinHarness('devin').tools)).toEqual({
    call: { id: 'c', tool: 'write', subject: '/repo/a.ipynb' },
    mutating: true,
  });
});

test('the operator answers allow or deny where the agent offers both, and is shown every option of the agent otherwise', () => {
  const both = ask({ toolCallId: 'c' }, ['allow_once', 'allow_always', 'reject_once']);
  expect(askOptions(both).map((option) => option.value)).toEqual(['allow-once', 'deny']);
  expect(chosenOption(both, 'allow-once')).toBe('allow_once-id');
  expect(chosenOption(both, 'deny')).toBe('reject_once-id');
  expect(chosenOption(both, 'allow_always-id')).toBeNull();

  const alwaysOnly = ask({ toolCallId: 'c' }, ['allow_always', 'reject_always']);
  expect(askOptions(alwaysOnly).map((option) => option.value)).toEqual(['allow_always-id', 'reject_always-id']);
  expect(chosenOption(alwaysOnly, 'reject_always-id')).toBe('reject_always-id');
  expect(chosenOption(alwaysOnly, 'allow-once')).toBeNull();
});
