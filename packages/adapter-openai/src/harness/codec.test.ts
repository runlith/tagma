import { expect, test } from 'bun:test';
import { codexTerminal } from './codex.js';

const codec = codexTerminal.hooks!.codec;

test('permission answers carry nested behavior and the caller’s reason', () => {
  expect(JSON.parse(codec.permission({ allowed: true, words: 'Pushing is done by hand here. (tagma rule ask-pushing)' }))).toEqual({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow', message: 'Pushing is done by hand here. (tagma rule ask-pushing)' },
    },
  });
  expect(JSON.parse(codec.permission({ allowed: false, words: 'no-force-push' }))).toEqual({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'no-force-push' } },
  });
});

test('context, prompt and tool words ride their own nested hook envelope', () => {
  expect(JSON.parse(codec.context('the law'))).toEqual({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'the law' },
  });
  expect(JSON.parse(codec.prompt!('the law'))).toEqual({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'the law' },
  });
  expect(JSON.parse(codec.tool('over the lines you read', 'after'))).toEqual({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'over the lines you read' },
  });
});

test('a trust entry is addressed by its file, snake-cased event and position', () => {
  expect(codec.file.trust?.key('/w/.codex/hooks.json', 'PreToolUse', 0, 1)).toBe('/w/.codex/hooks.json:pre_tool_use:0:1');
  expect(codec.file.trust).toMatchObject({ home: 'CODEX_HOME', file: 'config.toml', table: 'hooks.state' });
});
