import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { unthreadedCaller } from '../../agent/testing/caller';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '../record';
import { approvalModesLayer } from '../../modes/ApprovalModes';
import { modeLawLayer } from '../../modes/ModeLaw';
import { Effect, Layer, Schema } from 'effect';
import { Agent } from '../../agent/Agent';
import type { ToolGrant } from '../../catalog/resolveCatalog';
import { stepLimit } from '../../agent/AgentStep';
import type { AgentRunner } from '../../agent/AgentRunner';
import { makeAgentCalls } from '../../agent/AgentCalls';
import { Tool, toolExecute } from '../../agent/tool';
import type { ThreadRow, ThreadRunRow } from '../rows';
import { ThreadToolOutputVault, ThreadToolRegistry, threadToolSources, type ThreadToolSource } from '../ThreadPorts';
import { resolveCatalog } from '../../catalog/resolveCatalog';
import { registeredAgents } from '../conformance/agents';
import { admittedToolSources } from './admittedToolSources';
import { toolSupply } from './supply';
import { USER_QUESTION_SOURCE } from '../../tools/UserQuestion';
import { userQuestionToolSourceLayer } from './userQuestionToolSource';
import { ThreadAgentDoors, threadAgentDoorsLayer } from './ThreadAgentDoors';
import { ThreadAgents } from './ThreadAgents';
import { threadAgent } from './ThreadAgent';
import { ASKS_NEVER } from '../../permissions/vocabulary';
const OPEN = 'open-agent';
const FREE = 'source-free-agent';
const SELECTIVE = 'selective-agent';
const NAMED = 'named-agent';
const ASKING = 'asking-agent';
const plainTool = (value: string) =>
  Tool.make({
    display: () => ({ form: 'none' }),
    approval: ASKS_NEVER,
    description: 'Answer.',
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed(value),
  });
const planeSource: ThreadToolSource = { id: 'notes', tools: { plane_note: plainTool('noted') } };
const forkSource: ThreadToolSource = { id: 'fork', tools: { fork_thread: plainTool('forked') } };
const privateSource: ThreadToolSource = { id: 'private', tools: { private_note: plainTool('private-canary') } };
const GRANTS: Readonly<Record<string, ToolGrant>> = {
  [OPEN]: { sources: [{ source: OPEN }, { source: 'notes', narrowable: true }, { source: 'output' }] },
  [FREE]: { sources: [{ source: FREE }] },
  [SELECTIVE]: { sources: [{ source: SELECTIVE }, { source: 'notes' }] },
  [NAMED]: { sources: [{ source: NAMED }, { source: 'notes', tools: ['not_offered'] }] },
  [ASKING]: { sources: [{ source: ASKING }, { source: USER_QUESTION_SOURCE }] },
};
const agents = Effect.gen(function* () {
  const runner: AgentRunner = {
    calls: yield* makeAgentCalls({ history: 1 }),
    run: () => Effect.die('Catalog admission does not drive a run.'),
    host: () => Effect.die('Catalog admission does not open a host.'),
  };
  return yield* registeredAgents(
    [OPEN, FREE, SELECTIVE, NAMED, ASKING].map((id) =>
      threadAgent({
        agent: new Agent({
          id,
          name: id,
          description: 'Owns one tool.',
          instructions: () => 'Answer.',
          tools: () => ({ own_recall: plainTool('recalled') }),
          grant: GRANTS[id]!,
          stopWhen: [stepLimit(1)],
        }),
        runner,
        runPolicy: { userStartable: true, backgroundStartable: false },
        context: () => Effect.succeed({}),
      }),
    ),
    'host',
  );
});
const vault = ThreadToolOutputVault.of({
  scope: () => ({
    tools: { read_output: plainTool('output') },
    project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
    projectMessages: (messages) => Effect.succeed(messages),
    retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text', text, complete }),
    retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text', text, complete: false }, chars: text.length }),
    commitReferenced: () => Effect.void,
    dispose: () => Effect.void,
  }),
  settleOpen: () => Effect.void,
});
const rebuiltCatalog = Effect.fnUntraced(function* (agentId: string, sources: readonly ThreadToolSource[] = [planeSource]) {
  const doors = yield* ThreadAgentDoors;
  const context = yield* doors.toolContext({
    thread: { ...threadRow(agentId), transcript: [] },
    run: runRow(),
    sources: () => Effect.succeed(sources),
  });
  return context.catalog;
});
function threadRow(agentId: string): ThreadRow {
  const at = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'thread-1',
    ownerId: 'owner-1',
    agentId,
    parentThreadId: null,
    spawnedByRunId: null,
    bornOf: null,
    spawnRootId: 'thread-1',
    cacheGroup: 'thread-1',
    name: null,
    budgetTokens: null,
    profile: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    hostKind: null,
    hostId: null,
    bindings: {},
    pendingInteraction: null,
    account: null,
    provider: 'subscription',
    model: null,
    reasoning: null,
    switches: {},
    transport: NATIVE_BINDING,
    capabilities: NATIVE_CAPABILITIES,
    systemPrompt: null,
    pendingSystemPrompt: null,
    status: 'running',
    failureReason: null,
    contextReading: null,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
    history: [],
  };
}
function runRow(): ThreadRunRow {
  const at = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: 'run-1',
    kind: 'turn',
    origin: 'core',
    status: 'running',
    account: null,
    provider: null,
    model: null,
    reasoning: null,
    switches: {},
    approvalMode: 'trust',
    interactive: true,
    threadId: 'thread-1',
    ownerId: 'owner-1',
    progress: { stage: null, message: null },
    usage: null,
    cost: null,
    streamTail: null,
    resumes: 0,
    failureReason: null,
    failure: null,
    createdAt: at,
    startedAt: at,
    heartbeatAt: at,
    handedOverAt: null,
    finishedAt: null,
    settledNotifiedAt: null,
    settledBy: null,
    stopRequest: null,
    withdrawnWords: null,
    settledNotification: null,
    settledNotifyAttempts: 0,
    updatedAt: at,
  };
}
const fixture = threadAgentDoorsLayer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Layer.effect(ThreadAgents, agents),
      Layer.succeed(ThreadToolOutputVault, vault),
      modeLawLayer.pipe(Layer.provide(approvalModesLayer)),
    ),
  ),
);
layer(fixture)('what a definition grants is all an agent is offered', (it) => {
  it.effect(
    'a definition granting only itself gets only its own tool',
    Effect.fnUntraced(function* () {
      expect(Object.keys(yield* rebuiltCatalog(FREE, [planeSource, forkSource]))).toEqual(['own_recall']);
    }),
  );
  it.effect(
    'a rebuilt door offers and executes its granted plane verb and offers the output verb',
    Effect.fnUntraced(function* () {
      const catalog = yield* rebuiltCatalog(OPEN);
      expect(Object.keys(catalog).sort()).toEqual(['own_recall', 'plane_note', 'read_output']);
      expect(yield* toolExecute(catalog.plane_note!)!({}, { toolCallId: 'call-1', caller: unthreadedCaller, messages: [] })).toBe('noted');
    }),
  );
  it.effect(
    'an ungranted source is only named and is withheld by the resolver',
    Effect.fnUntraced(function* () {
      const registry = threadToolSources();
      yield* registry.register({ id: 'notes', owner: 'planes', names: ['plane_note'], offer: () => Effect.succeed(planeSource) });
      const sources = yield* admittedToolSources(yield* ThreadAgents, registry, { thread: threadRow(FREE), run: runRow() });
      const offered = yield* sources(null);
      expect(offered.map((source) => [source.id, source.declined])).toEqual([['notes', ['plane_note']]]);
      const resolved = resolveCatalog({ grant: GRANTS[FREE]! }, {}, [
        { source: FREE, tools: { own_recall: plainTool('recalled') } },
        ...toolSupply(offered, {}, null).contributions,
      ]);
      expect(Object.keys(resolved.catalog)).toEqual(['own_recall']);
      expect(resolved.withheld).toContainEqual({ name: 'plane_note', reason: 'not-granted' });
    }),
  );
  it.effect(
    'the registered question source is built only for an agent granted it',
    Effect.fnUntraced(function* () {
      const services = yield* Layer.build(
        userQuestionToolSourceLayer.pipe(Layer.provideMerge(Layer.succeed(ThreadToolRegistry, threadToolSources()))),
      );
      const offeredTo = Effect.fnUntraced(function* (agentId: string) {
        const sources = yield* admittedToolSources(yield* ThreadAgents, yield* ThreadToolRegistry, {
          thread: threadRow(agentId),
          run: runRow(),
        });
        return yield* sources(null);
      });
      const asking = yield* offeredTo(ASKING).pipe(Effect.provide(services));
      expect(asking.map((source) => [source.id, Object.keys(source.tools)])).toEqual([[USER_QUESTION_SOURCE, ['ask_user']]]);
      const offered = yield* offeredTo(OPEN).pipe(Effect.provide(services));
      expect(resolveCatalog({ grant: GRANTS[OPEN]! }, {}, toolSupply(offered, {}, null).contributions).withheld).toContainEqual({
        name: 'ask_user',
        reason: 'not-granted',
      });
    }),
  );
  it.effect(
    'an ungranted source stays out even when the port returns it, and granted tools still execute',
    Effect.fnUntraced(function* () {
      const catalog = yield* rebuiltCatalog(SELECTIVE, [planeSource, privateSource]);
      expect(Object.keys(catalog).sort()).toEqual(['own_recall', 'plane_note']);
      expect(yield* toolExecute(catalog.plane_note!)!({}, { toolCallId: 'resumed-call', caller: unthreadedCaller, messages: [] })).toBe(
        'noted',
      );
    }),
  );
  it.effect(
    'a name restriction does not substitute a different tool from its source',
    Effect.fnUntraced(function* () {
      expect(Object.keys(yield* rebuiltCatalog(NAMED, [planeSource]))).toEqual(['own_recall']);
    }),
  );
});
