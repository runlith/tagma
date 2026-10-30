import { expect, test } from 'bun:test';
import { cursorProgram } from './program';

test('the ask program passes the selected model, optional rung and instructions to the builtin runner', () => {
  const system = '- instructions\nwith unicode: 日本語';
  expect(cursorProgram.command).toEqual({ runner: 'cursor' });
  expect(cursorProgram.argv({ model: 'composer-2.5@context=1m', rung: 'high', system })).toEqual([
    '--ask',
    '--model',
    'composer-2.5@context=1m',
    '--effort',
    'high',
    `--system=${system}`,
  ]);
  expect(cursorProgram.argv({ model: 'composer-2.5', rung: null, system })).toEqual([
    '--ask',
    '--model',
    'composer-2.5',
    `--system=${system}`,
  ]);
});

test('the runner result preserves text and reported usage, and failed or unreadable runs refuse', () => {
  const text = '日本語\nA title';
  const usage = { inputTokens: 40, outputTokens: 7, cacheReadTokens: 25, cacheWriteTokens: 5, totalTokens: 47, reasoningTokens: 2 };
  expect(cursorProgram.answer({ stdout: JSON.stringify({ text, usage }), stderr: '', exit: 0 })).toMatchObject({
    _tag: 'Text',
    text,
    usage: { inputTokens: 40, outputTokens: 7, cacheReadInputTokens: 25, cacheWriteInputTokens: 5, totalTokens: 47, reasoningTokens: 2 },
  });
  expect(cursorProgram.answer({ stdout: JSON.stringify({ text }), stderr: '', exit: 0 })).toEqual({ _tag: 'Text', text, usage: undefined });
  for (const [stderr, refusal] of [
    ['unauthenticated: Invalid API key', 'ask-not-connected'],
    ['resource_exhausted: Rate limit exceeded', 'ask-quota'],
    ['resource_exhausted: Context window exceeded', 'ask-input-too-large'],
    ['internal: Upstream request failed', 'ask-provider-failed'],
  ] as const) {
    expect(cursorProgram.answer({ stdout: JSON.stringify({ text }), stderr, exit: 1 })).toEqual({
      _tag: 'Refused',
      refusal,
      message: stderr,
    });
  }
  for (const stdout of ['{', '{}', JSON.stringify({ text, usage: { inputTokens: '40' } })])
    expect(cursorProgram.answer({ stdout, stderr: '', exit: 0 })).toMatchObject({ _tag: 'Refused', refusal: 'ask-unreadable-answer' });
  expect(cursorProgram.answer({ stdout: '', stderr: 'interrupted', exit: null })).toMatchObject({
    _tag: 'Refused',
    refusal: 'ask-provider-failed',
  });
});
