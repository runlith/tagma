import { expect, test } from 'bun:test';
import type { HookVerdict } from '@runlith/tagma/adapter/hook';
import { SHIPPED_HARNESSES } from '../testing/builtin.js';
import type { HarnessAnswer } from '../contract/wire/call.js';
import { promptSupported, verdictOf } from './hookFormat.js';

const allowed = verdictOf({ _tag: 'Allowed', ruleId: 'ask-pushing', reason: 'Pushing is done by hand here.' }) as HookVerdict;
const denied = verdictOf({ _tag: 'Denied', ruleId: 'no-force-push', reason: 'Force pushing is denied here.' }) as HookVerdict;

test('a verdict keeps the permission decision and the rule that decided it', () => {
  expect(allowed).toMatchObject({ allowed: true, words: expect.stringContaining('ask-pushing') });
  expect(denied).toMatchObject({ allowed: false, words: expect.stringContaining('no-force-push') });
});

test('a question with no answer has no verdict', () => {
  const unanswered: HarnessAnswer = { _tag: 'Unanswered' };
  expect(verdictOf(unanswered)).toBeNull();
});

test('a prompt answer is taken only from CLIs whose own row declares it measured: Claude Code, Codex and Cursor, not OpenCode or Devin', () => {
  const taken = SHIPPED_HARNESSES.filter((row) => promptSupported(row.hooks)).map((row) => row.harness);
  expect(taken.sort()).toEqual(['claude-code', 'codex', 'cursor']);
});
