import type { Usage } from '@runlith/llm/schema/events';
import type { CommandProgram, ProgramAnswer, ProgramOutput, ProgramRefusal } from '@runlith/tagma/adapter/provider';
import { Result as Decoded, Schema } from 'effect';
import { claudeUsage } from './usage';

const Result = Schema.Struct({
  type: Schema.Literal('result'),
  subtype: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.Unknown),
  structured_output: Schema.optional(Schema.Unknown),
  usage: Schema.optional(Schema.Unknown),
});

const isResult = Schema.is(Result);

const decodeOutput = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

const resultOf = (stdout: string): typeof Result.Type | undefined => {
  const parsed = decodeOutput(stdout);
  if (Decoded.isFailure(parsed)) return undefined;
  const messages: readonly unknown[] = Array.isArray(parsed.success) ? parsed.success : [parsed.success];
  return messages.findLast(isResult);
};

const refusalOf = (said: string): ProgramRefusal => {
  if (/not logged in|invalid api key|\/login|authenticat|oauth token/iu.test(said)) return 'ask-not-connected';
  if (/usage limit|limit reached|quota|credit balance/iu.test(said)) return 'ask-quota';
  if (/prompt is too long|context (window|length)|too many tokens/iu.test(said)) return 'ask-input-too-large';
  return 'ask-provider-failed';
};

const refused = (said: string, usage: Usage | undefined): ProgramAnswer => {
  const message = said.trim() === '' ? 'Claude Code answered with an error and no words' : said.trim();
  return { _tag: 'Refused', refusal: refusalOf(message), message, usage };
};

export const claudeCodeProgram: CommandProgram = {
  command: 'claude',
  schemas: true,
  argv: (ask) => [
    '-p',
    '--model',
    ask.model,
    ...(ask.rung === null ? [] : ['--effort', ask.rung]),
    '--no-session-persistence',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--system-prompt',
    ask.system,
    '--output-format',
    'json',
    ...(ask.schema === undefined ? [] : ['--json-schema', JSON.stringify(ask.schema)]),
  ],
  answer: ({ stdout, stderr, exit }: ProgramOutput): ProgramAnswer => {
    const result = resultOf(stdout);
    if (result === undefined)
      return exit === 0
        ? { _tag: 'Refused', refusal: 'ask-unreadable-answer', message: 'Claude Code printed no result message' }
        : refused(stderr === '' ? stdout : stderr, undefined);
    const usage = claudeUsage(result.usage);
    const text = typeof result.result === 'string' ? result.result : '';
    if (result.is_error === true || result.subtype !== 'success') return refused(text === '' ? stderr : text, usage);
    if (result.structured_output !== undefined) return { _tag: 'Object', object: result.structured_output, usage };
    return { _tag: 'Text', text, usage };
  },
};
