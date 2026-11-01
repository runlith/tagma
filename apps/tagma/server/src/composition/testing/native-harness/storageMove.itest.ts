import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Agent } from '@runlith/agent/Agent';
import { stepLimit } from '@runlith/agent/AgentStep';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import {
  threadAgent,
  threadCaller,
  type ThreadPrepareInput,
  type ThreadRunInput,
  type ThreadView,
} from '@runlith/agent/thread/agents/ThreadAgent';
import { Tool, ToolFailed, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { Message } from '@runlith/llm/schema/messages';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { type LLMEvent, Usage } from '@runlith/llm/schema/events';
import { Context, Effect, Schema, Stream } from 'effect';
import { Blocks } from '../../../graph/contract/service/blocks.js';
import { blockName } from '../../../graph/contract/wire/references.js';
import { graphCommit } from '../../../graph/settings.js';
import { nativeDoor } from '../../../invocation/testing/native.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { threadContext, instructionRule, asThreadContext } from '../../../native-harness/testing/doubles.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { builtinMode } from '../modes.js';
import { fixtureOperationCatalog } from '../nativeCatalog.js';
import { servingLayer, withServing } from '../graph/serving/fixture.js';

const usage = new Usage({
  inputTokens: 1,
  nonCachedInputTokens: 1,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
});
const origin = new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('fixture') });
const toolCall = (step: number, name: string, input: unknown): readonly LLMEvent[] => [
  { type: 'step-start', index: 0 },
  { type: 'tool-input-start', id: `call-${step}`, name },
  { type: 'tool-call', id: `call-${step}`, name, input },
  { type: 'step-finish', index: 0, reason: 'tool-calls' },
  { type: 'finish', reason: 'tool-calls', usage },
];
const answer: readonly LLMEvent[] = [
  { type: 'step-start', index: 0 },
  { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', text: 'done' },
  { type: 'text-end', id: 'answer' },
  { type: 'step-finish', index: 0, reason: 'stop' },
  { type: 'finish', reason: 'stop', usage },
];

layer(servingLayer, { excludeTestServices: true })('native graph storage', (it) => {
  it.effect('a running thread reads the moved graph on its next step and through its existing native tools', () =>
    withServing(({ demo, pool, served, projectId, repo }) =>
      Effect.gen(function* () {
        yield* demo.graph.settings.write({ scope: 'project', projectId, key: graphCommit.id, value: 'manual' });
        const root = yield* Effect.provide(
          Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(projectId)),
          served.context,
        );
        const note = yield* demo
          .as('fixture', Context.get(served.context, Blocks).create({ projectId, parentId: root.id, title: 'record', body: 'before' }))
          .pipe(Effect.provide(served.context));
        const catalog = yield* fixtureOperationCatalog;
        const enforcement = Context.make(
          OperationChecks,
          OperationChecks.of({ run: (_id, _actor, work) => work, afterEdit: () => Effect.void }),
        ).pipe(
          Context.add(
            WorkingOrigins,
            WorkingOrigins.of({ of: () => Effect.succeed(null), rootOf: () => Effect.succeed(null), placeOf: () => Effect.succeed(null) }),
          ),
        );
        const execution = nativeDoor(enforcement, pool, catalog, (_ctx, graph) => Effect.succeed(Context.merge(demo.context, graph)));
        const places = { held: () => Effect.succeed([]), enter: () => Effect.void };
        const world = { root: repo, scratch: repo, facts: { shared: true }, world: { environment: { platform: 'darwin' } } };
        const target: ReturnType<typeof asThreadContext>['target'] = {
          graph: { projectId, root: repo },
          sourceKey: 'fixture',
          workingRoot: repo,
          work: { projectId, threadId: 'storage-reader' },
          runId: 'moving-run',
          generation: WorkspaceGeneration.make(0),
          place: null,
          admittedAt: '2026-01-01T00:00:00Z',
        };
        const graphAt: Parameters<typeof threadContext>[19] = (at) =>
          Effect.flatMap(pool.resolve({ projectId: at.projectId, cwd: at.root }), (current) => Effect.as(current.fresh(), current));
        const args = [
          {},
          { projectOf: () => Effect.succeed(projectId) },
          {},
          { of: () => Effect.succeed({ target, world }) },
          {},
          {},
          demo.graph.settings,
          {
            resolve: () =>
              Effect.succeed({
                contextFiles: [],
                shipped: [],
                skills: [],
                members: [],
                disabledSkills: new Set(),
                inventory: [],
                rejected: [],
              }),
          },
          { ensure: () => Effect.void },
          {},
          {},
          {},
          { of: () => Effect.succeed({}) },
          {},
          {},
          { of: () => Effect.succeed({ source: 'tagma' }) },
          { of: () => Effect.succeed({ _tag: 'None', reason: 'no image model', unblock: [] }) },
          { of: () => Effect.succeed('required') },
          demo.context,
          graphAt,
          demo.graph.units,
          testSessionIdentity,
          execution,
          {},
          {},
          places,
        ] as unknown as Parameters<typeof threadContext>;
        const context = threadContext(...args);
        const at = new Date('2026-01-01T00:00:00Z');
        const thread: ThreadView = {
          id: 'storage-reader',
          ownerId: 'fixture',
          agentId: 'reader',
          hostKind: null,
          hostId: null,
          bindings: {},
          cacheGroup: 'storage-reader',
          capabilities: NATIVE_CAPABILITIES,
          account: null,
          provider: 'openai-oauth',
          model: 'fixture',
          reasoning: null,
          switches: {},
          status: 'running',
          authority: { mode: 'bypass', bypassFrom: 'storage-reader' },
          profile: null,
          history: [],
          transcript: [],
          contextReading: null,
          createdAt: at,
          updatedAt: at,
        };
        const moveFor = (read: Tool) =>
          Tool.make({
            description: 'Resume a prepared graph read after moving its storage',
            parameters: Schema.Struct({}),
            display: () => ({ form: 'none' }),
            approval: ASKS_NEVER,
            execute: Effect.fnUntraced(
              function* () {
                const input = { blockIds: [blockName(note.uuid)], depth: 0 };
                const call = { toolCallId: 'prepared-read', caller: threadCaller(thread, 'moving-run') };
                const prepare = toolPrepare(read);
                const execute = toolExecute(read);
                if (prepare === null || execute === null) return yield* Effect.die('the native read declares prepare and execute');
                const pending = yield* prepare(input, call);
                yield* pool.moveProjectStorage({ projectId, mode: 'team' });
                const current = yield* pool.resolve({ projectId });
                yield* demo
                  .as('fixture', Context.get(current.context, Blocks).update({ id: note.id, body: 'after' }))
                  .pipe(Effect.provide(current.context));
                return yield* execute(input, { ...call, messages: [], prepared: pending.prepared });
              },
              (effect) => Effect.mapError(effect, (failure) => new ToolFailed({ reason: failure.message })),
            ),
          });
        let step = 0;
        const runner = yield* makeAgentRunner({
          idleMs: 5000,
          models: {
            request: () => ({
              origin,
              plannedOutputTokens: 32,
              text: () => Effect.die('the fixture uses streaming'),
              object: () => Effect.die('the fixture uses streaming'),
              stream: () =>
                Stream.suspend(() => {
                  step += 1;
                  return Stream.fromIterable(
                    step === 2
                      ? toolCall(step, 'move', {})
                      : step < 4
                        ? toolCall(step, 'read_block', { blockIds: [blockName(note.uuid)], depth: 0 })
                        : answer,
                  );
                }),
            }),
          },
        });
        const agent = threadAgent({
          agent: new Agent<ReturnType<typeof asThreadContext>>({
            id: 'reader',
            name: 'reader',
            description: 'Read a graph across its move',
            instructions: () => 'Read the record.',
            tools: (ctx) => {
              const native = execution.tools(ctx, ['read_block']);
              return { ...native, move: moveFor(native.read_block!) };
            },
            rules: [instructionRule(() => 'graph')],
            stopWhen: [stepLimit(4)],
          }),
          runner,
          context,
          runPolicy: { userStartable: true, backgroundStartable: false },
        });
        const input: ThreadRunInput & ThreadPrepareInput = {
          thread,
          stop: new RunStop(),
          run: {
            id: 'moving-run',
            status: 'running',
            account: null,
            provider: thread.provider,
            model: thread.model,
            reasoning: null,
            switches: {},
            approvalMode: 'bypass',
            interactive: false,
          },
          model: { ownerId: thread.ownerId, provider: thread.provider, model: thread.model, reasoning: null, switches: {} },
          messages: [Message.user('Read, move, and read again.')],
          sink: { push: () => Effect.void },
          modeOf: builtinMode('bypass'),
          signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
          supply: { sources: () => Effect.succeed([]), outputTools: {} },
          context: {
            project: ({ messages }) => Effect.succeed({ messages }),
            lower: (messages) => Effect.succeed(messages),
            observe: () => Effect.succeed(undefined),
          },
          toolOutputs: {
            project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
            projectMessages: (messages) => Effect.succeed(messages),
          },
        };
        const running = yield* (yield* agent.prepare(input)).start(input);
        yield* Effect.addFinalizer(() => running.close());
        expect(yield* running.output.text).toBe('done');
        const results = running.completedSteps().flatMap((taken) => taken.toolResults);
        expect(results.find((result) => result.toolName === 'move')?.output).toMatchObject({ status: 'ok', reads: [{ body: 'after' }] });
        expect(results.filter((result) => result.toolName === 'read_block').map((result) => result.output)).toMatchObject([
          { status: 'ok', reads: [{ body: 'before' }] },
          { status: 'ok', reads: [{ body: 'after' }] },
        ]);
      }),
    ),
  );
});
