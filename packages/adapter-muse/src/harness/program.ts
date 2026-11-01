import { Result, Schema } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import type { ProgramRefusal, RunnerProgram } from '@runlith/tagma/adapter/provider';
import { MUSE_CODE } from './acp.js';

const Output = Schema.Struct({
  text: Schema.String,
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.Finite,
      outputTokens: Schema.Finite,
      cacheReadTokens: Schema.Finite,
      cacheWriteTokens: Schema.Finite,
      totalTokens: Schema.Finite,
      reasoningTokens: Schema.Finite,
    }),
  ),
});
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Output));

const refusalOf = (message: string): ProgramRefusal => {
  if (/unauthenticated|authRequired|not signed in|muse login/iu.test(message)) return 'ask-not-connected';
  if (/inputTooLarge|context.{0,30}(window|length|limit|exceed)|too many tokens/iu.test(message)) return 'ask-input-too-large';
  if (/quota|rate.?limit|usage limit/iu.test(message)) return 'ask-quota';
  return 'ask-provider-failed';
};

export const museCodeProgram: RunnerProgram = {
  runner: MUSE_CODE,
  answer: ({ stdout, stderr, exit }) => {
    if (exit !== 0) {
      const message = (stderr || stdout).trim() || 'Muse Code ended the ask without an answer.';
      return { _tag: 'Refused', refusal: refusalOf(message), message };
    }
    const decoded = decode(stdout);
    if (Result.isFailure(decoded))
      return {
        _tag: 'Refused',
        refusal: 'ask-unreadable-answer',
        message: `Muse Code printed an unreadable answer: ${decoded.failure.message}`,
      };
    const { text, usage } = decoded.success;
    return {
      _tag: 'Text',
      text,
      usage:
        usage === undefined
          ? undefined
          : new Usage({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadInputTokens: usage.cacheReadTokens,
              cacheWriteInputTokens: usage.cacheWriteTokens,
              totalTokens: usage.totalTokens,
              reasoningTokens: usage.reasoningTokens,
            }),
    };
  },
};
