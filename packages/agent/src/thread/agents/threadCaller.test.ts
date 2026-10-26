import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { makeAgentCalls } from '../../agent/AgentCalls';
import { builtinMode } from '../../agent/testing/modes';
import { Effect, Schema } from 'effect';
import { Agent } from '../../agent/Agent';
import type { AgentRunner } from '../../agent/AgentRunner';
import { stepLimit } from '../../agent/AgentStep';
import type { ToolCaller } from '../../agent/contracts';
import { Tool } from '../../agent/tool';
import { threadAgent, type ThreadRunView, type ThreadView } from './ThreadAgent';
import { ASKS_NEVER } from '../../permissions/vocabulary';
import { NATIVE_CAPABILITIES } from '../record';
const thread = {
  id: 'thread-9',
  ownerId: 'owner-1',
  agentId: 'probe',
  hostKind: null,
  hostId: null,
  bindings: { poker: 't3/s5' },
  cacheGroup: 'thread-9',
  capabilities: NATIVE_CAPABILITIES,
  account: null,
  provider: 'openai',
  model: null,
  reasoning: null,
  switches: {},
  status: 'running',
  authority: { mode: 'trust' as const, bypassFrom: null },
  profile: null,
  contextReading: null,
  history: [],
  transcript: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies ThreadView;
const run = {
  id: 'run-4',
  status: 'running',
  account: null,
  provider: null,
  model: null,
  reasoning: null,
  switches: {},
  approvalMode: 'trust',
  interactive: true,
} satisfies ThreadRunView;
const EXPECTED: ToolCaller = {
  agentId: 'probe',
  ownerId: 'owner-1',
  thread: { threadId: 'thread-9', runId: 'run-4', bindings: { poker: 't3/s5' } },
};
const probe = new Agent<object>({
  id: 'probe',
  name: 'Probe',
  description: 'An agent that only opens doors.',
  instructions: () => 'Probe.',
  tools: () => ({}),
  grant: { sources: [{ source: 'probe' }] },
  stopWhen: [stepLimit(1)],
});
describe('the caller a host fills from an accepted run', () => {
  it.effect(
    'one door hands the same caller to the preparation and the execution of a call',
    Effect.fnUntraced(function* () {
      const runner: AgentRunner = {
        calls: yield* makeAgentCalls({ history: 1 }),
        run: () => Effect.die('No run is driven here.'),
        host: () => Effect.die('No host is opened here.'),
      };
      const host = threadAgent({
        agent: probe,
        runner,
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({}),
      });
      const seen: ToolCaller[] = [];
      const tool = Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Records who called it.',
        parameters: Schema.Struct({}),
        prepare: (_input, call) =>
          Effect.sync(() => {
            seen.push(call.caller);
            return { subjects: [] };
          }),
        execute: (_input, call) =>
          Effect.sync(() => {
            seen.push(call.caller);
            return 'done';
          }),
      });
      const door = yield* host.toolDoor({ thread, run, modeOf: builtinMode('trust') });
      yield* door.settle({ name: 'probe', tool, input: {}, options: { toolCallId: 'call-1', messages: [] } });
      expect(seen).toEqual([EXPECTED, EXPECTED]);
      expect(seen[1]).toBe(seen[0]);
    }),
  );
});
