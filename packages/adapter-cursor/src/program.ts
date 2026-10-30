import { Result, Schema } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import type { AskProgram, ProgramRefusal } from '@runlith/tagma/adapter/provider';

const Output = Schema.Struct({
  text: Schema.String,
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.Finite,
      outputTokens: Schema.Finite,
      cacheReadTokens: Schema.Finite,
      cacheWriteTokens: Schema.Finite,
      totalTokens: Schema.Finite,
      reasoningTokens: Schema.optional(Schema.Finite),
    }),
  ),
});
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Output));

const refusalOf = (message: string): ProgramRefusal => {
  if (/unauthenticated|permission_denied|authenticationerror|invalid api key|not (logged|signed) in|api key is missing/iu.test(message))
    return 'ask-not-connected';
  if (/context.{0,30}(window|length|limit|exceed)|prompt.{0,20}too long|too many tokens|input.{0,20}too large|token limit/iu.test(message))
    return 'ask-input-too-large';
  if (/resource_exhausted|rate.?limit|quota|usage limit|credit balance/iu.test(message)) return 'ask-quota';
  return 'ask-provider-failed';
};

export const cursorProgram: AskProgram = {
  command: { runner: 'cursor' },
  schemas: false,
  argv: (ask) => ['--ask', '--model', ask.model, ...(ask.rung === null ? [] : ['--effort', ask.rung]), `--system=${ask.system}`],
  answer: ({ stdout, stderr, exit }) => {
    if (exit !== 0) {
      const message = (stderr || stdout).trim() || 'Cursor ended the ask without an answer.';
      return { _tag: 'Refused', refusal: refusalOf(message), message };
    }
    const decoded = decode(stdout);
    if (Result.isFailure(decoded))
      return {
        _tag: 'Refused',
        refusal: 'ask-unreadable-answer',
        message: `Cursor printed an unreadable answer: ${decoded.failure.message}`,
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
