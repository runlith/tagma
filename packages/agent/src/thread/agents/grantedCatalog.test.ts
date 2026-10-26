import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { builtinMode } from '../../agent/testing/modes';
import { Effect, Schema, Stream } from 'effect';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import type { Message } from '@runlith/llm/schema/messages';
import { Agent } from '../../agent/Agent';
import { TOOL_SEARCH_TOOL } from '../../agent/AgentDeferredTools';
import type { AgentContext } from '../../agent/AgentContext';
import { type AgentRunner, makeAgentRunner } from '../../agent/AgentRunner';
import { RunStop } from '../../agent/RunStop';
import { agentStepToolPolicy } from '../../agent/policy/AgentRuntimePolicy';
import { stepLimit } from '../../agent/AgentStep';
import type { ModelRequest } from '../../agent/modelPort';
import type { AgentToolOutputs } from '../../agent/ToolOutput';
import { Tool } from '../../agent/tool';
import type { ToolGrant } from '../../catalog/resolveCatalog';
import type { ThreadToolSource } from '../ThreadPorts';
import type { ThreadSupplyPlan } from './supply';
import { threadUserQuestionTools } from '../../tools/UserQuestion';
import { threadAgent, type ThreadContextPreparation, type ThreadPrepareInput, type ThreadRunInput, type ThreadView } from './ThreadAgent';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../permissions/vocabulary';
import { NATIVE_CAPABILITIES } from '../record';
const ran: string[] = [];
const tool = (
  name: string,
  extra: {
    exposure?: 'deferred';
  } = {},
) =>
  Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: `The ${name} verb.`,
    parameters: Schema.Struct({}),
    execute: () => Effect.sync(() => (ran.push(name), name)),
    ...extra,
  });
const sources: readonly ThreadToolSource[] = [
  { id: 'game', tools: { look: tool('look'), act: tool('act'), secret: tool('secret') } },
  { id: 'fork', tools: { fork_thread: tool('fork_thread') } },
  { id: 'user-question', tools: threadUserQuestionTools },
  { id: 'collaboration', tools: { send_message: tool('send_message') } },
  { id: 'mcp', tools: { mcp__guide__lookup: tool('mcp__guide__lookup', { exposure: 'deferred' }) } },
];
const outputTools = { read_tool_output: tool('read_tool_output') };
const player: ToolGrant = { sources: [{ source: 'game', tools: ['look', 'act'] }] };
const WITHHELD = ['ask_user', 'fork_thread', 'mcp__guide__lookup', 'read_tool_output', 'secret', 'send_message', TOOL_SEARCH_TOOL].sort();
const withheldNames = (
  withheld: readonly {
    name: string;
    reason: string;
  }[],
) =>
  withheld
    .map((entry) => {
      expect(entry.reason).toBe('not-granted');
      return entry.name;
    })
    .sort();
describe('a definition that grants look and act is offered look and act on every road', () => {
  it.effect(
    'the native road, a restored keep-list and a refreshed scope offer exactly look and act, and an ungranted call is refused unrun',
    Effect.fnUntraced(function* () {
      ran.length = 0;
      const offered: string[][] = [];
      const seen: (readonly Message[])[] = [];
      const restored: ThreadContextPreparation = {
        context: { generation: 1, sourceKey: 'tree-b', requestId: 'req-1' },
        supply: supply({ tools: ['look', 'act', 'fork_thread', 'secret', 'ask_user'] }),
        publish: () => Effect.succeed(true),
        deny: () => Effect.void,
      };
      const runner = yield* scriptedRunner(
        [toolTurn('look'), toolTurn('fork_thread'), toolTurn('secret'), textTurn('Done.')],
        offered,
        seen,
      );
      const given: ThreadRunInput & ThreadPrepareInput = {
        ...input(),
        boundary: ({ stepNumber }) => Effect.succeed(stepNumber === 1 ? restored : null),
      };
      const handle = yield* (yield* playing(runner).prepare(given)).start(given);
      yield* handle.output.response;
      expect(offered).toEqual([
        ['look', 'act'],
        ['look', 'act'],
        ['look', 'act'],
        ['look', 'act'],
      ]);
      expect(Object.keys(handle.catalog)).toEqual(['look', 'act']);
      expect(withheldNames(handle.withheld)).toEqual(WITHHELD);
      expect(ran).toEqual(['look']);
      const answered = (seen.at(-1) ?? []).flatMap((message) =>
        message.role === 'tool' ? message.content.flatMap((part) => (part.type === 'tool-result' ? [part.name] : [])) : [],
      );
      expect(answered).toEqual(['look', 'fork_thread', 'secret']);
      yield* handle.close();
    }),
  );
  it.effect(
    'the hosted road lists exactly look and act, with the rest withheld and named',
    Effect.fnUntraced(function* () {
      const runner = yield* scriptedRunner([], [], []);
      const prepared = yield* playing(runner).prepare({ thread: probeThread, run: probeRun, supply: supply({}) });
      const hosted = yield* prepared.host!({
        thread: probeThread,
        run: probeRun,
        stop: new RunStop(),
        model: input().model,
        modeOf: builtinMode('trust'),
        toolOutputs: inertToolOutputs,
      });
      expect(Object.keys(hosted.catalog())).toEqual(['look', 'act']);
      expect(withheldNames(hosted.withheld())).toEqual(WITHHELD);
      yield* hosted.close();
    }),
  );
});
describe('a step directive works inside what was admitted', () => {
  it('requiring, requesting or restricting to an ungranted tool brings it back nowhere', () => {
    const names = ['look', 'act'];
    expect(agentStepToolPolicy([{ type: 'require', tool: 'fork_thread' }], names)).toEqual({ activeTools: null, toolChoice: null });
    expect(agentStepToolPolicy([{ type: 'restrict', tools: ['act', 'fork_thread'] }], names)).toEqual({
      activeTools: ['act'],
      toolChoice: null,
    });
    expect(agentStepToolPolicy([{ type: 'request', tool: 'act', text: 'Act now.' }], names).toolChoice).toEqual({
      type: 'tool',
      toolName: 'act',
    });
  });
});
function supply(profile: { readonly tools?: readonly string[] }): ThreadSupplyPlan {
  return { sources: () => Effect.succeed(sources), outputTools, restored: profile.tools };
}
function playing(runner: AgentRunner) {
  return threadAgent<Record<string, never>>({
    agent: new Agent<Record<string, never>>({
      id: 'player',
      name: 'Player',
      description: 'Knows look and act.',
      instructions: () => 'Play.',
      tools: () => ({}),
      grant: player,
      stopWhen: [stepLimit(6)],
    }),
    runner,
    runPolicy: { userStartable: true, backgroundStartable: false },
    context: () => Effect.succeed({}),
  });
}
function scriptedRunner(turns: readonly (readonly LLMEvent[])[], offered: string[][], seen: (readonly Message[])[]) {
  const request: ModelRequest = {
    plannedOutputTokens: 1_000,
    text: () => Effect.die(new Error('never opened')),
    object: () => Effect.die(new Error('never opened')),
    stream: (given) =>
      Stream.suspend(() => {
        offered.push(Object.keys(given.tools));
        seen.push(given.messages);
        return Stream.fromIterable(turns[offered.length - 1] ?? textTurn('Nothing scripted.'));
      }),
  };
  return makeAgentRunner({ models: { request: () => request }, idleMs: 30_000 });
}
const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const textTurn = (text: string): LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text },
  { type: 'text-end', id: 't' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];
let calls = 0;
const toolTurn = (name: string): LLMEvent[] => {
  const id = `call-${(calls += 1)}`;
  return [
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id, name },
    { type: 'tool-call', id, name, input: {} },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls', usage },
  ];
};
function input(): ThreadRunInput & ThreadPrepareInput {
  return {
    thread: probeThread,
    sink: { push: () => Effect.void },
    run: probeRun,
    stop: new RunStop(),
    model: { ownerId: 'owner-1', provider: 'openai', model: 'a-model', reasoning: null, switches: {} },
    modeOf: builtinMode('trust'),
    messages: [],
    signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
    supply: supply({}),
    context: inertContext,
    toolOutputs: inertToolOutputs,
  };
}
const inertContext: AgentContext = {
  project: ({ messages }) => Effect.succeed({ messages }),
  lower: (messages) => Effect.succeed(messages),
  observe: () => Effect.succeed(undefined),
};
const inertToolOutputs: AgentToolOutputs = {
  project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
  projectMessages: (messages) => Effect.succeed(messages),
};
const probeThread: ThreadView = {
  id: 'thread-1',
  ownerId: 'owner-1',
  agentId: 'player',
  hostKind: null,
  hostId: null,
  bindings: {},
  cacheGroup: 'thread-1',
  capabilities: NATIVE_CAPABILITIES,
  account: null,
  provider: 'openai',
  model: null,
  reasoning: null,
  switches: {},
  status: 'idle',
  authority: { mode: 'trust' as const, bypassFrom: null },
  profile: null,
  contextReading: null,
  history: [],
  transcript: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const probeRun = {
  id: 'run-1',
  status: 'running',
  account: null,
  provider: null,
  model: null,
  reasoning: null,
  switches: {},
  approvalMode: 'trust',
  interactive: false,
} as const;
