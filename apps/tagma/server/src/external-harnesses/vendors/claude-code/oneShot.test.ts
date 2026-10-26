import { expect, test } from 'bun:test';
import { claudeCode } from './row.js';

const answer = claudeCode.launch.oneShot!.answer;

test('the sessionless CLI answer carries only the token usage its result reports', () => {
  expect(answer(JSON.stringify({ type: 'result', subtype: 'success', result: 'TITLE: Prefix reuse' }))).toEqual({
    outcome: 'answered',
    text: 'TITLE: Prefix reuse',
  });
  expect(
    answer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'TITLE: Prefix reuse',
        usage: { input_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 5, output_tokens: 4 },
      }),
    ),
  ).toMatchObject({
    text: 'TITLE: Prefix reuse',
    usage: {
      inputTokens: 45,
      nonCachedInputTokens: 10,
      cacheReadInputTokens: 30,
      cacheWriteInputTokens: 5,
      outputTokens: 4,
    },
  });
  expect(
    answer(
      JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        result: 'unfinished',
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
    ),
  ).toMatchObject({ outcome: 'failed', text: 'unfinished', reason: 'error_during_execution', usage: { inputTokens: 10, outputTokens: 1 } });
  expect(answer('{')).toBeNull();
});
