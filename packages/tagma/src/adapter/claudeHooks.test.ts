import { expect, test } from 'bun:test';
import { claudeCodec } from './claudeHooks';

test('permission answers carry the decision and its denying rule', () => {
  expect(JSON.parse(claudeCodec.permission({ allowed: true, words: 'Allowed (tagma rule ask-pushing)' }))).toMatchObject({
    decision: 'approve',
  });
  expect(claudeCodec.permission({ allowed: false, words: 'Denied (tagma rule no-force-push)' })).toContain('no-force-push');
});

test('context answers use the envelope of the hook occasion', () => {
  expect(claudeCodec.context('the law')).toBe('the law');
  expect(JSON.parse(claudeCodec.prompt!('the law'))).toEqual({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'the law' },
  });
  expect(JSON.parse(claudeCodec.tool('over the lines you read', 'after'))).toEqual({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'over the lines you read' },
  });
});
