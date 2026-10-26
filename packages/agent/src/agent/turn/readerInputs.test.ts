import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Effect, Schema, Stream } from 'effect';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import type { ThreadSignal } from '../../transcript/parts';
import { Agent } from '../Agent';
import { makeAgentRunner } from '../AgentRunner';
import { withAgentReaderInput } from '../AgentSignal';
import { stepLimit } from '../AgentStep';
import type { ModelRequest, ModelRequester } from '../modelPort';
import { agentRule } from '../policy/AgentRuntimePolicy';
import { builtinMode } from '../testing/modes';
import { recordRun } from '../testing/recording';
import { Tool } from '../tool';
const USAGE = new Usage({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
const text = (said: string): readonly LLMEvent[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text: said },
  { type: 'text-end', id: 't' },
  { type: 'finish', reason: 'stop', usage: USAGE },
];
const call = (id: string): readonly LLMEvent[] => [
  { type: 'tool-call', id, name: 'look', input: {} },
  { type: 'finish', reason: 'tool-calls', usage: USAGE },
];
const scripted = (turns: readonly (readonly LLMEvent[])[]) => {
  const requests: (readonly Message[])[] = [];
  const request: ModelRequest = {
    plannedOutputTokens: 1_000,
    origin: new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.5') }),
    text: () => Effect.die('unused'),
    object: () => Effect.die('unused'),
    stream: (input: { readonly messages: readonly Message[] }) =>
      Stream.suspend(() => {
        requests.push(input.messages);
        return Stream.fromIterable(turns[requests.length - 1] ?? text('Done.'));
      }),
  } as unknown as ModelRequest;
  return { requests, requester: { request: () => request } as unknown as ModelRequester };
};
const NOTE = 'NOTE-AFTER-WORDS';
const noting = new Agent<Record<string, never>>({
  id: 'noting',
  name: 'Noting',
  description: 'Gets a note after every word of its reader.',
  instructions: () => 'Answer.',
  tools: () => ({
    look: Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_NEVER,
      description: 'Look.',
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed('seen'),
    }),
  }),
  rules: [
    agentRule<Record<string, never>>(
      'notes',
      (ctx) =>
        ctx.hook === 'beforeStep' && (ctx.readerInputs?.length ?? 0) > 0
          ? { type: 'guide', text: NOTE, retell: false, state: { inputs: ctx.readerInputs } }
          : null,
      { owner: 'test', hook: 'beforeStep' },
    ),
  ],
  stopWhen: [stepLimit(8)],
});
const input = (runId: string, signals?: () => readonly ThreadSignal[]) => ({
  runId,
  ctx: {},
  model: { ownerId: 'owner', provider: 'openai-oauth' as const, model: 'gpt-5.5', reasoning: 'high', switches: {} },
  messages: [withAgentReaderInput(Message.user('Fix the parser.'), 'words-1')],
  approval: { mode: 'trust' as const, interactive: false },
  modeOf: builtinMode('trust'),
  signals:
    signals === undefined
      ? undefined
      : {
          drain: () => Effect.sync(signals),
          hasPending: () => Effect.succeed(false),
        },
});
const lastText = (messages: readonly Message[]) =>
  messages.flatMap((message) => message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []))).at(-1) ?? '';
it.live(
  'words that open the run get one frame on the first step, after them, and a step of tool results gets none',
  Effect.fnUntraced(function* () {
    const model = scripted([call('look-1'), text('Fixed.')]);
    const run = yield* recordRun(yield* makeAgentRunner({ models: model.requester, idleMs: 30_000 }), noting, input('run-open'));
    yield* run.output.text;
    expect(run.guidance.map((frame) => ({ step: frame.stepNumber, sources: frame.sources }))).toEqual([
      { step: 0, sources: [{ hook: 'beforeStep', ruleId: 'notes', retell: false, state: { inputs: ['words-1'] } }] },
    ]);
    expect(lastText(model.requests[0]!)).toContain(NOTE);
    expect(model.requests[1]!.filter((message) => lastText([message]).includes(NOTE))).toHaveLength(1);
  }),
);
it.live(
  'words read in the middle of the run get their frame in the step they join, and a report gets none',
  Effect.fnUntraced(function* () {
    const at = new Date(0).toISOString();
    const arriving: ThreadSignal[][] = [
      [],
      [
        { id: 'report-1', type: 'report', addressee: 'transport', text: 'child done', from: 'child', senderThreadId: 'c', occurredAt: at },
        { id: 'words-2', type: 'user-message', addressee: 'reader', text: 'Also the lexer.', occurredAt: at },
      ],
    ];
    const model = scripted([call('look-1'), text('Both fixed.')]);
    const run = yield* recordRun(
      yield* makeAgentRunner({ models: model.requester, idleMs: 30_000 }),
      noting,
      input('run-steer', () => arriving.shift() ?? []),
    );
    yield* run.output.text;
    expect(run.guidance.map((frame) => [frame.stepNumber, frame.sources[0]?.state])).toEqual([
      [0, { inputs: ['words-1'] }],
      [1, { inputs: ['words-2'] }],
    ]);
    const second = model.requests[1]!.map((message) => lastText([message]));
    expect(second.findLastIndex((said) => said.includes(NOTE))).toBeGreaterThan(
      second.findIndex((said) => said.includes('Also the lexer.')),
    );
  }),
);
