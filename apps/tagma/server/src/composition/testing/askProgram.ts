import { fileURLToPath } from 'node:url';
import { Usage } from '@runlith/llm/schema/events';
import { type AskProgram, defineAdapter, type ProgramAnswer } from '@runlith/tagma/adapter/provider';

export const ASK_PROGRAM_PROVIDER = 'ask-program';
export const ASK_PROGRAM_MODEL = 'scripted-1';
export const ASK_PROGRAM_KEY = `${ASK_PROGRAM_PROVIDER}:${ASK_PROGRAM_MODEL}`;

const SCRIPT = fileURLToPath(new URL('./askProgramScript.ts', import.meta.url));

const unreadable: ProgramAnswer = { _tag: 'Refused', refusal: 'ask-unreadable-answer', message: 'the scripted program printed no answer' };

const answered = (stdout: string): ProgramAnswer => {
  let said: { readonly text?: unknown; readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number } };
  try {
    said = JSON.parse(stdout) as typeof said;
  } catch {
    return unreadable;
  }
  if (typeof said.text !== 'string') return unreadable;
  return { _tag: 'Text', text: said.text, usage: said.usage === undefined ? undefined : new Usage(said.usage) };
};

export const askProgramFixture: AskProgram = {
  command: process.execPath,
  schemas: false,
  argv: (ask) => [SCRIPT, '--model', ask.model, ...(ask.rung === null ? [] : ['--effort', ask.rung]), '--system', ask.system],
  answer: ({ stdout, stderr, exit }) =>
    exit === 0
      ? answered(stdout)
      : {
          _tag: 'Refused',
          refusal: /usage limit/u.test(stderr) ? 'ask-quota' : 'ask-provider-failed',
          message: stderr.trim() === '' ? `the scripted program exited ${exit}` : stderr.trim(),
        },
};

export const adapter = defineAdapter(() => [
  {
    id: ASK_PROGRAM_PROVIDER,
    label: 'Scripted program',
    kind: 'harness',
    auth: 'cli',
    models: {
      [ASK_PROGRAM_MODEL]: {
        label: 'Scripted 1',
        capacity: { context: 2_000_000, output: 4_096 },
        capabilities: ['text'],
        reasoning: ['low', 'high'],
        defaultReasoning: 'low',
      },
    },
    defaultTextModel: ASK_PROGRAM_MODEL,
    cacheLifetime: { promisedSeconds: null, prior: null },
    environment: () => [{ _tag: 'Set', name: 'ASK_PROGRAM_ACCOUNT', value: 'default' }],
    asks: { program: askProgramFixture },
  },
]);
