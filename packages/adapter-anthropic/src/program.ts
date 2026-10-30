import { Usage } from '@runlith/llm/schema/events';
import type { AskProgram, ProgramAnswer, ProgramOutput, ProgramRefusal } from '@runlith/tagma/adapter/provider';

type Spend = {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
};

type Result = {
  readonly type: 'result';
  readonly subtype?: string;
  readonly is_error?: boolean;
  readonly result?: unknown;
  readonly structured_output?: unknown;
  readonly usage?: Spend;
};

const counted = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const usageOf = (spend: Spend | undefined): Usage | undefined => {
  if (spend === undefined || spend === null || typeof spend !== 'object') return undefined;
  const fresh = counted(spend.input_tokens);
  const read = counted(spend.cache_read_input_tokens);
  const written = counted(spend.cache_creation_input_tokens);
  const output = counted(spend.output_tokens);
  const input = [fresh, read, written].some((value) => value !== undefined) ? (fresh ?? 0) + (read ?? 0) + (written ?? 0) : undefined;
  if (input === undefined && output === undefined) return undefined;
  return new Usage({
    inputTokens: input,
    nonCachedInputTokens: fresh,
    outputTokens: output,
    cacheReadInputTokens: read,
    cacheWriteInputTokens: written,
  });
};

const resultOf = (stdout: string): Result | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const messages: readonly unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return messages.findLast(
    (message): message is Result => typeof message === 'object' && message !== null && (message as Result).type === 'result',
  );
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

export const claudeCodeProgram: AskProgram = {
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
    const usage = usageOf(result.usage);
    const text = typeof result.result === 'string' ? result.result : '';
    if (result.is_error === true || result.subtype !== 'success') return refused(text === '' ? stderr : text, usage);
    if (result.structured_output !== undefined) return { _tag: 'Object', object: result.structured_output, usage };
    return { _tag: 'Text', text, usage };
  },
};
