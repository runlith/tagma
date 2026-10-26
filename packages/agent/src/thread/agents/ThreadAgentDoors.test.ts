import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Effect, Layer, Schema } from 'effect';
import { makeAgentCalls } from '../../agent/AgentCalls';
import { Agent } from '../../agent/Agent';
import type { AgentRunner } from '../../agent/AgentRunner';
import { stepLimit } from '../../agent/AgentStep';
import { Tool } from '../../agent/tool';
import { ApprovalModes, builtinModeRegistry } from '../../modes/ApprovalModes';
import { modeLawLayer } from '../../modes/ModeLaw';
import { registeredAgents } from '../conformance/agents';
import { ThreadToolOutputVault } from '../ThreadPorts';
import { threadAgent, type ThreadRunView, type ThreadView } from './ThreadAgent';
import { ThreadAgentDoors, threadAgentDoorsLayer } from './ThreadAgentDoors';
import { ThreadAgents } from './ThreadAgents';
import { ASKS_IN_REVIEW } from '../../permissions/vocabulary';
import { NATIVE_CAPABILITIES } from '../record';
const at = new Date('2026-01-01T00:00:00.000Z');
const thread = {
  id: 'thread-plan',
  ownerId: 'owner-1',
  agentId: 'probe',
  hostKind: null,
  hostId: null,
  bindings: {},
  cacheGroup: 'thread-plan',
  capabilities: NATIVE_CAPABILITIES,
  account: null,
  provider: 'openai',
  model: null,
  reasoning: null,
  switches: {},
  status: 'running',
  authority: { mode: 'plan', bypassFrom: null },
  profile: null,
  contextReading: null,
  history: [],
  transcript: [],
  createdAt: at,
  updatedAt: at,
} satisfies ThreadView;
const run = {
  id: 'run-plan',
  status: 'running',
  account: null,
  provider: null,
  model: null,
  reasoning: null,
  switches: {},
  approvalMode: 'plan',
  interactive: true,
} satisfies ThreadRunView;
const probeOver = (runner: AgentRunner) =>
  threadAgent<object>({
    agent: new Agent<object>({
      id: 'probe',
      name: 'Probe',
      description: 'An agent that only opens doors.',
      instructions: () => 'Probe.',
      tools: () => ({}),
      grant: { sources: [{ source: 'probe' }] },
      stopWhen: [stepLimit(1)],
    }),
    runner,
    runPolicy: { userStartable: true, backgroundStartable: false },
    context: () => Effect.succeed({}),
  });
it.effect(
  'a door rebuilt for an answered or adopted call judges by the registered mode of its thread',
  Effect.fnUntraced(function* () {
    const modes = builtinModeRegistry();
    yield* modes.register('test', { id: 'plan', label: 'Plan', description: 'Lets every call through.', icon: 'eye', strictness: 0 });
    const runner: AgentRunner = {
      calls: yield* makeAgentCalls({ history: 1 }),
      run: () => Effect.die('No run is driven here.'),
      host: () => Effect.die('No host is opened here.'),
    };
    const services = yield* Layer.build(
      threadAgentDoorsLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ThreadAgents, yield* registeredAgents([probeOver(runner)], 'host')),
            Layer.succeed(
              ThreadToolOutputVault,
              ThreadToolOutputVault.of({
                scope: () => {
                  throw new Error('No output scope is opened here.');
                },
                settleOpen: () => Effect.die('No outputs are settled here.'),
              }),
            ),
            modeLawLayer.pipe(Layer.provide(Layer.succeed(ApprovalModes, modes))),
          ),
        ),
      ),
    );
    const write = Tool.make({
      display: () => ({ form: 'none' }),
      approval: ASKS_IN_REVIEW,
      description: 'Writes.',
      parameters: Schema.Struct({}),
      mutates: true,
      execute: () => Effect.succeed('written'),
    });
    const door = yield* Context.get(services, ThreadAgentDoors).toolDoor({ thread, run });
    const settled = yield* door.settle({ name: 'write', tool: write, input: {}, options: { toolCallId: 'call-1', messages: [] } });
    expect(settled).toMatchObject({ executed: true, verdict: { kind: 'answered' }, output: 'written' });
  }),
);
