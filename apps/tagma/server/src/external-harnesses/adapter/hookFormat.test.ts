import { expect, test } from 'bun:test';
import type { HarnessAnswer } from '../contract/wire/call.js';
import { contextAnswer, hookTrust, permissionAnswer, promptAnswer, promptSupported, toolAnswer } from './hookFormat.js';

const allowed: HarnessAnswer = { _tag: 'Allowed', ruleId: 'ask-pushing', reason: 'Pushing is done by hand here.' };
const denied: HarnessAnswer = { _tag: 'Denied', ruleId: 'no-force-push', reason: 'Force pushing is denied here.' };

test('an allowed call is approved to Claude-shaped harnesses and allowed to Cursor', () => {
  expect(JSON.parse(permissionAnswer('claude-code', allowed)!)).toMatchObject({ decision: 'approve' });
  expect(JSON.parse(permissionAnswer('cursor', allowed)!)).toMatchObject({ permission: 'allow' });
});

test('Codex reads a verdict as a nested behavior, and carries no top-level decision', () => {
  const answer = JSON.parse(permissionAnswer('codex', allowed)!);
  expect(answer).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow', message: 'Pushing is done by hand here. (tagma rule ask-pushing)' },
    },
  });
  expect(JSON.parse(permissionAnswer('codex', denied)!).hookSpecificOutput.decision.behavior).toBe('deny');
  expect(Object.keys(answer)).toEqual(['hookSpecificOutput']);
});

test('a verdict carries the rule that decided it, in every format', () => {
  for (const format of ['claude-code', 'codex', 'cursor'] as const) {
    expect(permissionAnswer(format, denied)).toContain('no-force-push');
  }
});

test('a question with no answer prints nothing on any format', () => {
  const unanswered: HarnessAnswer = { _tag: 'Unanswered' };
  expect(permissionAnswer('claude-code', unanswered)).toBeNull();
  expect(permissionAnswer('codex', unanswered)).toBeNull();
  expect(permissionAnswer('cursor', unanswered)).toBeNull();
});

test('a session-start context rides additionalContext to Codex and plainly to Claude', () => {
  const answer = JSON.parse(contextAnswer('codex', 'the law'));
  expect(answer).toEqual({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'the law' },
  });
  expect(Object.keys(answer)).toEqual(['hookSpecificOutput']);
  expect(contextAnswer('claude-code', 'the law')).toBe('the law');
});

test('a session-start context rides additionalContext to Devin', () => {
  const answer = JSON.parse(contextAnswer('devin', 'the law'));
  expect(answer).toEqual({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'the law' },
  });
  expect(Object.keys(answer)).toEqual(['hookSpecificOutput']);
});

test('a session-start context rides top-level additional_context to Cursor', () => {
  const answer = JSON.parse(contextAnswer('cursor', 'the law'));
  expect(answer).toEqual({ additional_context: 'the law' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
});

test('a prompt answer rides top-level additional_context to Cursor, the nested envelope to Codex and silence elsewhere', () => {
  const answer = JSON.parse(promptAnswer('cursor', 'the law')!);
  expect(answer).toEqual({ additional_context: 'the law' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
  expect(JSON.parse(promptAnswer('codex', 'the law')!)).toEqual({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'the law' },
  });
  expect(promptAnswer('claude-code', 'the law')).toBeNull();
  expect(promptAnswer('gemini', 'the law')).toBeNull();
  for (const format of ['claude-code', 'cursor', 'codex', 'gemini', 'devin'] as const) {
    expect(promptSupported(format)).toBe(promptAnswer(format, 'the law') !== null);
  }
});

test('a prompt answer stays silent for Devin: measured, and closed by decision', () => {
  expect(promptAnswer('devin', 'the law')).toBeNull();
  expect(promptSupported('devin')).toBe(false);
});

test('post-tool words ride top-level additional_context to Cursor and the nested envelope elsewhere', () => {
  const answer = JSON.parse(toolAnswer('cursor', 'over the lines you read'));
  expect(answer).toEqual({ additional_context: 'over the lines you read' });
  expect(Object.keys(answer)).toEqual(['additional_context']);
  for (const format of ['claude-code', 'codex', 'devin'] as const) {
    expect(JSON.parse(toolAnswer(format, 'over the lines you read'))).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'over the lines you read' },
    });
  }
  expect(JSON.parse(toolAnswer('gemini', 'over the lines you read'))).toEqual({
    hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: 'over the lines you read' },
  });
});

test('a Codex trust entry is addressed by its file, its snake-cased event and its position', () => {
  expect(hookTrust('codex')?.key('/w/.codex/hooks.json', 'PreToolUse', 0, 1)).toBe('/w/.codex/hooks.json:pre_tool_use:0:1');
  expect(hookTrust('codex')).toMatchObject({ home: 'CODEX_HOME', file: 'config.toml', table: 'hooks.state' });
});
