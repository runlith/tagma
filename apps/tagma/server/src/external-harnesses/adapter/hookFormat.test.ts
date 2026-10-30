import { expect, test } from 'bun:test';
import type { HookVerdict } from '@runlith/tagma/adapter/hook';
import { SHIPPED_HARNESSES } from '../testing/builtin.js';
import type { HarnessAnswer } from '../contract/wire/call.js';
import { claudeCodec } from '@runlith/tagma/adapter/claude-hooks';
import { promptSupported, verdictOf } from './hookFormat.js';

const allowed = verdictOf({ _tag: 'Allowed', ruleId: 'ask-pushing', reason: 'Pushing is done by hand here.' }) as HookVerdict;
const denied = verdictOf({ _tag: 'Denied', ruleId: 'no-force-push', reason: 'Force pushing is denied here.' }) as HookVerdict;

test('an allowed call is approved to Claude-shaped harnesses', () => {
  expect(JSON.parse(claudeCodec.permission(allowed))).toMatchObject({ decision: 'approve' });
});

test('a verdict carries the rule that decided it, in every codec', () => {
  expect(claudeCodec.permission(denied)).toContain('no-force-push');
});

test('a question with no answer has no verdict', () => {
  const unanswered: HarnessAnswer = { _tag: 'Unanswered' };
  expect(verdictOf(unanswered)).toBeNull();
});

test('a session-start context rides plainly to Claude', () => {
  expect(claudeCodec.context('the law')).toBe('the law');
});

test('a prompt answer rides the nested envelope to Claude Code', () => {
  expect(JSON.parse(claudeCodec.prompt!('the law'))).toEqual({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'the law' },
  });
});

test('a prompt answer is taken only from CLIs whose own row declares it measured: Claude Code, Codex and Cursor, not OpenCode or Devin', () => {
  const taken = SHIPPED_HARNESSES.filter((row) => promptSupported(row.hooks)).map((row) => row.harness);
  expect(taken.sort()).toEqual(['claude-code', 'codex', 'cursor']);
});

test('post-tool words ride the nested envelope to Claude Code', () => {
  expect(JSON.parse(claudeCodec.tool('over the lines you read', 'after'))).toEqual({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'over the lines you read' },
  });
});
