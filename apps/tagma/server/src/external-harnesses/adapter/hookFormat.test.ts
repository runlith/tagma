import { expect, test } from 'bun:test';
import type { HookVerdict } from '@runlith/tagma/adapter/hook';
import { BUILTIN_HARNESSES } from '../vendors/builtin.js';
import { codexCodec } from '../vendors/codex/codec.js';
import { cursorCodec } from '../vendors/cursor/codec.js';
import { devinCodec } from '../vendors/devin/codec.js';
import type { HarnessAnswer } from '../contract/wire/call.js';
import { claudeCodec } from '@runlith/tagma/adapter/claude-hooks';
import { promptSupported, verdictOf } from './hookFormat.js';

const allowed = verdictOf({ _tag: 'Allowed', ruleId: 'ask-pushing', reason: 'Pushing is done by hand here.' }) as HookVerdict;
const denied = verdictOf({ _tag: 'Denied', ruleId: 'no-force-push', reason: 'Force pushing is denied here.' }) as HookVerdict;

test('an allowed call is approved to Claude-shaped harnesses and allowed to Cursor', () => {
  expect(JSON.parse(claudeCodec.permission(allowed))).toMatchObject({ decision: 'approve' });
  expect(JSON.parse(cursorCodec.permission(allowed))).toMatchObject({ permission: 'allow' });
});

test('Codex reads a verdict as a nested behavior, and carries no top-level decision', () => {
  const answer = JSON.parse(codexCodec.permission(allowed));
  expect(answer).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow', message: 'Pushing is done by hand here. (tagma rule ask-pushing)' },
    },
  });
  expect(JSON.parse(codexCodec.permission(denied)).hookSpecificOutput.decision.behavior).toBe('deny');
  expect(Object.keys(answer)).toEqual(['hookSpecificOutput']);
});

test('a verdict carries the rule that decided it, in every codec', () => {
  for (const codec of [claudeCodec, codexCodec, cursorCodec]) expect(codec.permission(denied)).toContain('no-force-push');
});

test('a question with no answer has no verdict', () => {
  const unanswered: HarnessAnswer = { _tag: 'Unanswered' };
  expect(verdictOf(unanswered)).toBeNull();
});

test('a session-start context rides additionalContext to Codex and Devin and plainly to Claude', () => {
  for (const codec of [codexCodec, devinCodec]) {
    const answer = JSON.parse(codec.context('the law'));
    expect(answer).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'the law' } });
    expect(Object.keys(answer)).toEqual(['hookSpecificOutput']);
  }
  expect(claudeCodec.context('the law')).toBe('the law');
});

test('a session-start context rides top-level additional_context to Cursor', () => {
  const answer = JSON.parse(cursorCodec.context('the law'));
  expect(answer).toEqual({ additional_context: 'the law' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
});

test('a prompt answer rides top-level additional_context to Cursor, the nested envelope to Codex and Claude Code and none elsewhere', () => {
  const answer = JSON.parse(cursorCodec.prompt!('the law'));
  expect(answer).toEqual({ additional_context: 'the law' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
  for (const codec of [codexCodec, claudeCodec]) {
    expect(JSON.parse(codec.prompt!('the law'))).toEqual({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'the law' },
    });
  }
  expect(devinCodec.prompt).toBeNull();
});

test('a prompt answer is taken only from CLIs whose own row declares it measured: Claude Code, Codex and Cursor, not OpenCode or Devin', () => {
  const taken = BUILTIN_HARNESSES.filter((row) => promptSupported(row.hooks)).map((row) => row.harness);
  expect(taken.sort()).toEqual(['claude-code', 'codex', 'cursor']);
});

test('post-tool words ride top-level additional_context to Cursor and the nested envelope elsewhere', () => {
  const answer = JSON.parse(cursorCodec.tool('over the lines you read', 'after'));
  expect(answer).toEqual({ additional_context: 'over the lines you read' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
  for (const codec of [claudeCodec, codexCodec, devinCodec]) {
    expect(JSON.parse(codec.tool('over the lines you read', 'after'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'over the lines you read' },
    });
  }
});

test('a Codex trust entry is addressed by its file, its snake-cased event and its position', () => {
  expect(codexCodec.file.trust?.key('/w/.codex/hooks.json', 'PreToolUse', 0, 1)).toBe('/w/.codex/hooks.json:pre_tool_use:0:1');
  expect(codexCodec.file.trust).toMatchObject({ home: 'CODEX_HOME', file: 'config.toml', table: 'hooks.state' });
});
