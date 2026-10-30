import { expect, test } from 'bun:test';
import { claudeCodeProgram } from './program';

const SPEND = { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 5, output_tokens: 4 };

const printed = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 812, num_turns: 1, session_id: 'f0e1', ...fields });

test('the print-mode argv names the chosen model and rung, the schema when given, and never the input', () => {
  const schema = { type: 'object', properties: { verdict: { type: 'boolean' } }, required: ['verdict'] };
  const argv = claudeCodeProgram.argv({ model: 'claude-sonnet-5-5', rung: 'low', system: 'Name the thread.', schema });
  expect(argv.slice(0, 5)).toEqual(['-p', '--model', 'claude-sonnet-5-5', '--effort', 'low']);
  expect(argv[argv.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
  expect(argv[argv.indexOf('--system-prompt') + 1]).toBe('Name the thread.');
  expect(claudeCodeProgram.argv({ model: 'claude-haiku-4-5', rung: null, system: 's' })).not.toContain('--effort');
});

test('a recorded result reads as text or as the structured object, with the spend it reports', () => {
  expect(claudeCodeProgram.answer({ stdout: printed({ result: 'TITLE: Prefix reuse', usage: SPEND }), stderr: '', exit: 0 })).toMatchObject(
    {
      _tag: 'Text',
      text: 'TITLE: Prefix reuse',
      usage: { inputTokens: 45, nonCachedInputTokens: 10, cacheReadInputTokens: 30, cacheWriteInputTokens: 5, outputTokens: 4 },
    },
  );
  expect(claudeCodeProgram.answer({ stdout: printed({ result: '', structured_output: { verdict: true } }), stderr: '', exit: 0 })).toEqual({
    _tag: 'Object',
    object: { verdict: true },
    usage: undefined,
  });
});

test('a failed or killed process cannot publish its success-shaped result', () => {
  const stdout = printed({ result: 'unfinished answer', structured_output: { verdict: true }, usage: SPEND });
  expect(claudeCodeProgram.answer({ stdout, stderr: 'usage limit reached', exit: 1 })).toMatchObject({
    _tag: 'Refused',
    refusal: 'ask-quota',
    usage: { inputTokens: 45, outputTokens: 4 },
  });
  expect(claudeCodeProgram.answer({ stdout, stderr: '', exit: null })).toMatchObject({
    _tag: 'Refused',
    refusal: 'ask-provider-failed',
  });
});

test('a failed run becomes the refusal its words name', () => {
  const limited = printed({ subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1793000000' });
  expect(claudeCodeProgram.answer({ stdout: limited, stderr: '', exit: 1 })).toMatchObject({ _tag: 'Refused', refusal: 'ask-quota' });
  expect(claudeCodeProgram.answer({ stdout: '', stderr: 'Invalid API key · Please run /login', exit: 1 })).toMatchObject({
    _tag: 'Refused',
    refusal: 'ask-not-connected',
  });
  expect(claudeCodeProgram.answer({ stdout: '{', stderr: '', exit: 0 })).toMatchObject({
    _tag: 'Refused',
    refusal: 'ask-unreadable-answer',
  });
});
