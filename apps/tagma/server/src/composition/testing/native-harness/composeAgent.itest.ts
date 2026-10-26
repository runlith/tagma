import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentRunner, makeAgentRunner, type AgentSink } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import type { AgentRuntimeGuidance } from '@runlith/agent/contracts';
import type { AgentToolOutputs } from '@runlith/agent/ToolOutput';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import { Tool } from '@runlith/agent/tool';
import { USER_QUESTION_SOURCE, threadUserQuestionTools } from '@runlith/agent/tools/UserQuestion';
import type { ThreadAgent, ThreadPrepareInput, ThreadRunInput, ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import type { ThreadSources } from '@runlith/agent/thread/agents/supply';
import { threadToolSources } from '@runlith/agent/thread/ThreadPorts';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import { NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { capabilitySources } from '../../../native-harness/testing/doubles.js';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { type LLMEvent, Usage } from '@runlith/llm/schema/events';
import { Message } from '@runlith/llm/schema/messages';
import type { ServedWeb } from '@runlith/llm/profiles/vendorWeb';
import type { ThreadWeb } from '../../../native-harness/turns/runWebs.js';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import type { McpServers } from '../../../mcp/contract/service/servers.js';
import { Context, Effect, FileSystem, Layer, Schema, Stream } from 'effect';
import { builtinMode } from '../modes.js';
import type { ThreadExecution } from '../../../native-harness/contract/service/execution.js';
import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core/errors';
import { renderWorldState } from '@runlith/agent/WorldState';
import { versionedShelf } from '../../../artifacts/testing/doubles.js';
import { WorkspaceInputs } from '../../../native-harness/contract/service/inputs.js';
import {
  workspaceInputsLayer,
  assemblePrompt,
  promptDocument,
  mcpBoundTools,
  instructionSnapshot,
  capabilitySections,
  agentLibrary,
  asAgentDeclaration,
  conversationSources,
  tagma,
  capabilityLossSection,
  capabilityUnavailable,
  agentFilesOf,
  asThreadContext,
} from '../../../native-harness/testing/doubles.js';
import { composeAgent as composeWithSections } from '../../../native-harness/testing/doubles.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { OperationId } from '../../../platform/contract/wire/ids.js';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { demoGraphLayer, withDemo, type EffectDemo } from '../graphFixture.js';
import { Git } from '@runlith/git/Git';
import { CheckoutFlights } from '@runlith/agent-tools/CheckoutFlights';
import { changeRecordOf, idleCommands, intakeOf } from '../../../change-record/testing/doubles.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import { makeWalks } from '../../../change-record/lines/walks.js';
import { renderSection } from '../../../threads/testing/doubles.js';
import { doctrine } from '../../doctrine.js';
import { DEFAULT_CATALOGS, tagsOfCatalogs } from '../../../catalogs/contract/wire/registry.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
const shippedVocabulary = tagIndex(tagsOfCatalogs(DEFAULT_CATALOGS), BEHAVIOUR_REGISTRY);
import { COMMENT_POLICIES, type CommentPolicy } from '@runlith/source-comments';
import { SUBMIT_OPERATION, OPERATION_IDS, OPERATOR_ONLY_OPERATIONS, type CatalogOperationId } from '../../catalog.js';
import { collectedOperations } from '../../manifest.js';
import { CALL_OPERATION_IDS } from '../../../native-harness/contract/wire/operations/calls.js';
import { CONTEXT_OPERATION_IDS } from '../../../native-harness/contract/wire/operations/context.js';
import { COMMAND_RULE_OPERATION_IDS } from '../../../executions/contract/wire/operations/commandRules.js';
import { SWEEP_OPERATION } from '../../../change-record/contract/wire/writes.js';
import { HARNESS_OPERATION_IDS } from '../../../external-harnesses/contract/wire/operations.js';
import { MCP_OPERATION_IDS } from '../../../mcp/contract/wire/operations.js';
import { THREAD_OPERATION_IDS } from '../../../threads/testing/doubles.js';
import { FOLDER_OPERATIONS } from '../../../threads/contract/wire/operations/folders.js';
import { ATTENTION_OPERATIONS } from '../../../threads/contract/wire/operations/attention.js';
import { NOTE_OPERATIONS } from '../../../threads/contract/wire/operations/notes.js';
import { SEARCH_OPERATION_IDS } from '../../../threads/contract/wire/operations/search.js';
import { commentPolicy } from '../../../graph/testing/doubles.js';
import { nativeOffers } from '../../../invocation/testing/native.js';
import { fixtureOperationCatalog } from '../nativeCatalog.js';
import type { CapabilityId } from '../../../platform/contract/wire/capability.js';
import { servedCapabilities } from './capabilities.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { NativeAgents } from '../../../threads/contract/service/engine.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { declaredAgents, teamLess } from '../../../threads/testing/doubles.js';
import { checkoutWorld } from '../../../executions/testing/doubles.js';
import { CHECKOUT_WORLD_KIND } from '../../../executions/contract/service/worlds.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import type { ThreadWorld, WorldFacts } from '../../../executions/contract/service/worlds.js';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { InstructionSet } from '../../../graph/contract/wire/instructions.js';
import { BEHAVIOUR_REGISTRY } from '../../manifest.js';
import { ENTRY_KINDS, NATIVE_AGENT_RULES } from '../../manifest.js';
import { AgentRuleRegistry } from '@runlith/agent/AgentRuntimePolicy';
import { builtinRegistry } from '../providerCatalog.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { signedBy } from '../../../invocation/testing/call.js';
const homeOnly = {
  held: () => Effect.succeed([]),
  locate: () => Effect.succeed(null),
  resource: () => Effect.succeed(null),
  enter: () => Effect.void,
  graphAt: () => Effect.die('a home-only thread opens no other graph'),
} as unknown as ReturnType<typeof asThreadContext>['places'];
const makeComposition = Effect.fnUntraced(function* (instructionWorld: EffectDemo) {
  const operationCatalog = yield* fixtureOperationCatalog;
  const capabilityOffers = nativeOffers(operationCatalog);
  const { offers } = capabilityOffers;
  const offeredIds = (id: CapabilityId, facts: WorldFacts, comments: CommentPolicy): readonly string[] =>
    offers(id, { world: facts, comments, images: true }).map((offered) => offered.id);
  const DEFINITIONS = yield* servedCapabilities();
  const ruleRegistry = new AgentRuleRegistry(NATIVE_AGENT_RULES);
  const CAPABILITY_IDS = DEFINITIONS.list().map((capability) => capability.id);
  const describedAs = (id: string): string => DEFINITIONS.find(id)?.description ?? id;
  const DOCTRINE = yield* doctrine;
  const JOURNALED_OPERATION_IDS = (yield* collectedOperations).journaled;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'compose-agent-' });
  yield* fs.makeDirectory(join(root, 'tree'));
  yield* fs.makeDirectory(join(root, 'scratch'));
  yield* fs.writeFileString(join(root, 'tree', 'NOTE.txt'), 'the tree says hello\n');
  const prompts: string[] = [];
  type Composing = Parameters<typeof composeWithSections>;
  const composeAgent = (
    declaration: Composing[1],
    runner: Composing[3],
    rows: Composing[4],
    mandate: Composing[5],
    execution: ThreadExecution['Service'],
    context: Composing[7],
    ...rest: Composing extends [unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, ...infer Tail]
      ? Partial<Tail>
      : never
  ): ReturnType<typeof composeWithSections> => {
    const [sections, ...hooks] = rest;
    return composeWithSections(
      ruleRegistry,
      declaration,
      DEFINITIONS,
      runner,
      rows,
      mandate,
      teamLess,
      (thread, use) => Effect.map(context(thread, use), (ctx) => ({ ...ctx, execution, offers: capabilityOffers, places: homeOnly })),
      sections ?? DOCTRINE.contributed,
      ...hooks,
    );
  };
  const at = new Date('2026-01-01T00:00:00Z');
  const thread: ThreadView = {
    id: 'thread-1',
    ownerId: 'fixture',
    agentId: 'tree',
    hostKind: 'sandbox',
    hostId: 'sandbox-1',
    bindings: {},
    cacheGroup: 'thread-1',
    capabilities: NATIVE_CAPABILITIES,
    account: null,
    provider: 'openai-oauth',
    model: 'gpt-5.5',
    reasoning: null,
    switches: {},
    status: 'running',
    profile: null,
    history: [],
    transcript: [],
    contextReading: null,
    authority: { mode: 'bypass', bypassFrom: 'thread-1' },
    createdAt: at,
    updatedAt: at,
  };
  const sandboxWorld = (): ThreadWorld => ({
    kind: 'sandbox',
    facts: { shared: false, history: false, network: false },
    world: {
      files: machineWorld.files,
      exec: machineWorld.exec,
      environment: {
        ...machineWorld.environment,
        platform: 'linux',
        shell: '/bin/sh',
      },
    },
    root: join(root, 'tree'),
    scratch: join(root, 'scratch'),
    alive: () => true,
  });
  const context = (world: ThreadWorld) =>
    ({
      thread,
      world,
      projectId: instructionWorld.projectId,
      projectRoot: join(root, 'tree'),
      target: { graph: { projectId: instructionWorld.projectId, root: instructionWorld.demoRoot } },
      graph: Effect.succeed(instructionWorld.context),
      settings: instructionWorld.graph.settings,
      comments: () => commentPolicy().fallback,
      vocabulary: () => shippedVocabulary,
      origin: null,
      identity: sessionIdentity,
      grants: testGrantSigner,
      commandTimes: unruledTimes,
    }) as unknown as ReturnType<typeof asThreadContext>;
  const undelegatedThreads = {
    rows: {},
    mandate: { delegationLineage: () => Effect.succeed({ own: null, nearest: null }) },
  } as unknown as ThreadParts;
  const origin = new ModelIdentity({
    provider: ProviderID.make('openai-oauth'),
    model: ModelID.make('gpt-5.5'),
  });
  const usage = new Usage({
    inputTokens: 1,
    nonCachedInputTokens: 1,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
    totalTokens: 2,
  });
  const namesOnly: ThreadExecution['Service'] = {
    tools: (_ctx, ids) =>
      Object.fromEntries(
        ids.map(
          (id) =>
            [
              id,
              Tool.make({ display: () => ({ form: 'none' }), approval: ASKS_NEVER, description: id, parameters: Schema.Struct({}) }),
            ] as const,
        ),
      ),
    afterEdit: () => Effect.void,
    touched: () => Effect.die('a names-only door reads no touch brief'),
  };
  function scriptedRunner(
    script: (turn: number) => LLMEvent[] | Effect.Effect<LLMEvent[]>,
    offered: {
      tools: string[];
      active?: string[] | undefined;
      messages: readonly Message[];
    }[],
  ): ReturnType<typeof makeAgentRunner> {
    return makeAgentRunner({
      idleMs: 5000,
      models: {
        request: (selection: ModelRequestInput) => ({
          system: selection.instructions,
          origin,
          plannedOutputTokens: 32,
          text: () => {
            throw new Error('the fixture opens streamed requests only');
          },
          object: () => {
            throw new Error('the fixture opens streamed requests only');
          },
          stream: (input: ModelStreamInput) =>
            Stream.suspend(() => {
              if (selection.instructions !== undefined) prompts.push(selection.instructions);
              offered.push({
                tools: Object.keys(input.tools).sort(),
                active: input.activeTools === undefined ? undefined : [...input.activeTools].sort(),
                messages: input.messages,
              });
              const events = script(offered.length);
              return Effect.isEffect(events) ? Stream.unwrap(Effect.map(events, Stream.fromIterable)) : Stream.fromIterable(events);
            }),
        }),
      },
    });
  }
  const call = (turn: number, name: string, input: unknown): LLMEvent[] => [
    { type: 'step-start', index: 0 },
    { type: 'tool-input-start', id: `call-${turn}`, name },
    { type: 'tool-call', id: `call-${turn}`, name, input },
    { type: 'step-finish', index: 0, reason: 'tool-calls' },
    { type: 'finish', reason: 'tool-calls', usage },
  ];
  const answer = (turn: number, text: string): LLMEvent[] => [
    { type: 'step-start', index: 0 },
    { type: 'text-start', id: `text-${turn}` },
    { type: 'text-delta', id: `text-${turn}`, text },
    { type: 'text-end', id: `text-${turn}` },
    { type: 'step-finish', index: 0, reason: 'stop' },
    { type: 'finish', reason: 'stop', usage },
  ];
  const outputs: AgentToolOutputs = {
    project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
    projectMessages: (messages) => Effect.succeed(messages),
  };
  const registry = threadToolSources();
  yield* registry.register({
    id: USER_QUESTION_SOURCE,
    owner: 'fixture',
    names: Object.keys(threadUserQuestionTools),
    offer: () => Effect.succeed({ id: USER_QUESTION_SOURCE, tools: threadUserQuestionTools }),
  });
  yield* capabilitySources(registry, DEFINITIONS);
  const grantedSources = (agent: ThreadAgent<WriteUnit<'machine'>>, as: ThreadView): ThreadSources => {
    const granted = agent.grant.sources.map((entry) => entry.source);
    return (context) => registry.offers({ thread: as as unknown as ThreadRow, context }, granted);
  };
  const input = (
    agent: ThreadAgent<WriteUnit<'machine'>>,
    id: string,
    messages: readonly Message[],
    as: ThreadView = thread,
  ): ThreadRunInput & ThreadPrepareInput => ({
    thread: as,
    sink: { push: () => Effect.void },
    modeOf: builtinMode('bypass'),
    stop: new RunStop(),
    run: {
      id,
      status: 'running',
      account: null,
      provider: 'openai-oauth',
      model: 'gpt-5.5',
      reasoning: null,
      switches: {},
      approvalMode: 'bypass',
      interactive: false,
    },
    model: {
      ownerId: 'fixture',
      provider: 'openai-oauth',
      model: 'gpt-5.5',
      reasoning: null,
      switches: {},
    },
    messages,
    signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
    supply: { sources: grantedSources(agent, as), outputTools: {} },
    context: {
      project: ({ messages }) => Effect.succeed({ messages }),
      lower: (messages) => Effect.succeed(messages),
      observe: () => Effect.succeed(undefined),
    },
    toolOutputs: outputs,
    commitInstructions: (text: string) => Effect.succeed(text),
  });
  const launch = (agent: ThreadAgent<WriteUnit<'machine'>>, given: ThreadRunInput & ThreadPrepareInput) =>
    Effect.flatMap(agent.prepare(given), (prepared) => prepared.start(given));
  const tree = asAgentDeclaration({
    id: 'tree',
    name: 'Tree',
    description: 'An agent over a tree and nothing else.',
    identity: 'You are the tree agent.',
    capabilities: ['files', 'shell'],
    sources: conversationSources(),
  });
  const sectionsOf = (declaration: Parameters<typeof composeAgent>[0], facts: WorldFacts): readonly string[] => [
    ...new Set(DEFINITIONS.effective(declaration).declared.flatMap((capability) => capabilitySections()(capability, facts))),
  ];
  const mcpContext = (mcpServers: unknown) =>
    asThreadContext({
      thread,
      projectId: instructionWorld.projectId,
      target: { graph: { projectId: instructionWorld.projectId, root: instructionWorld.demoRoot } },
      world: sandboxWorld(),
      mcpServers,
      origin: null,
      identity: sessionIdentity,
      grants: testGrantSigner,
      commandTimes: unruledTimes,
      comments: () => commentPolicy().fallback,
      vocabulary: () => shippedVocabulary,
      graph: Effect.succeed(instructionWorld.context),
      settings: instructionWorld.graph.settings,
      mcp: () => [],
      mcpBound: mcpBoundTools(),
    });
  const webbed = asAgentDeclaration({ ...tree, id: 'webbed', capabilities: ['web'] });
  const searched = Effect.fnUntraced(function* (web: ThreadWeb) {
    const offered: {
      tools: string[];
      active?: string[];
      messages: readonly Message[];
    }[] = [];
    const runner = yield* scriptedRunner((turn) => answer(turn, 'Done.'), offered);
    const world: ThreadWorld = {
      ...sandboxWorld(),
      world: {
        ...sandboxWorld().world,
        egress: {
          fetch: (async () => new Response('')) as unknown as typeof fetch,
          fetchDefaultMs: 1000,
          fetchCeilingMs: 2000,
          searchMs: 1000,
        },
      },
    };
    const composed = composeAgent(webbed, runner, undelegatedThreads.rows, undelegatedThreads.mandate, namesOnly, () =>
      Effect.succeed({ ...context(world), web }),
    );
    const run = yield* launch(composed, input(composed, 'web', [Message.user('Look it up.')]));
    yield* run.output.response;
    return offered[0]!;
  });
  return {
    launch,
    operationCatalog,
    capabilityOffers,
    offers,
    offeredIds,
    DEFINITIONS,
    CAPABILITY_IDS,
    DOCTRINE,
    JOURNALED_OPERATION_IDS,
    root,
    prompts,
    instructionWorld,
    composeAgent,
    scriptedRunner,
    sandboxWorld,
    context,
    input,
    thread,
    tree,
    call,
    answer,
    undelegatedThreads,
    namesOnly,
    describedAs,
    sectionsOf,
    mcpContext,
    searched,
    registry,
  };
});
layer(demoGraphLayer().pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })('agent composition', (it) => {
  it.effect('a declaration over files and a shell is offered exactly the tree, in the world its thread stands in', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
            launch,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            active?: string[] | undefined;
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner(
            (turn) =>
              turn === 1
                ? call(turn, 'read', { path: 'NOTE.txt' })
                : turn === 2
                  ? call(turn, 'write', {
                      path: 'ANSWER.txt',
                      content: 'the agent answers\n',
                    })
                  : answer(turn, 'Done.'),
            offered,
          );
          const world = sandboxWorld();
          const composed = composeAgent(tree, runner, undelegatedThreads.rows, undelegatedThreads.mandate, namesOnly, () =>
            Effect.succeed(context(world)),
          );
          expect(composed.id).toBe('tree');
          expect(composed.grant.sources.map((entry) => entry.source)).toEqual(['tree', ...conversationSources()]);
          const run = yield* launch(composed, input(composed, 'first', [Message.user('Read, then answer.')]));
          yield* run.output.response;
          expect(offered[0]?.tools).toEqual([
            'ask_user',
            'bash',
            'delete',
            'edit',
            'glob',
            'grep',
            'ls',
            'read',
            'rename',
            'tool_search',
            'write',
          ]);
          expect(offered[0]?.active).toEqual(['bash', 'edit', 'glob', 'grep', 'ls', 'read', 'tool_search', 'write']);
          expect(JSON.stringify(offered[1]?.messages)).toContain('the tree says hello');
          expect(readFileSync(join(root, 'tree', 'ANSWER.txt'), 'utf8')).toBe('the agent answers\n');
          const prompt = prompts[0] ?? '';
          expect(prompt.startsWith('You are the tree agent.')).toBe(true);
          expect(prompt).toContain(join(root, 'tree'));
        }),
      ),
    ),
  );
  it.effect('file and shell readers receive code law, explanations and peer writes once without holding the graph', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            launch,
          } = yield* makeComposition(demo);
          const { graph, projectId } = demo;
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(join(demo.demoRoot, 'NOTE.txt'), 'the reader sees this file\n');
          const metadata = 'A fixture declaration carried only to graph readers.';
          yield* graph.blocks.create({ projectId, tags: ['tag'], title: 'Case', body: metadata, fields: { id: 'case' } });
          const law = 'Keep the fixture cursor monotonic.';
          const explanation = 'Rewinding the cursor would replay the fixture.';
          for (const [tags, title, body] of [
            [['rule', 'case'], 'Fixture law', law],
            [['explanation', 'case'], 'Fixture explanation', explanation],
          ] as const) {
            yield* graph.blocks.create({ projectId, tags, title, body, sources: [{ kind: 'file', ref: 'NOTE.txt' }] });
          }
          const peer = { harness: 'test', key: 'peer' };
          const task = yield* graph.blocks.create({ projectId, tags: ['task'], title: 'Move the fixture cursor' });
          yield* graph.tasks.claim({ id: task.id }).pipe(signedBy(peer));
          yield* graph.touches.touch({ projectId, shown: [{ path: 'NOTE.txt', as: 'wrote' }] }).pipe(signedBy(peer));
          const execution: ThreadExecution['Service'] = {
            ...namesOnly,
            touched: (ctx, at, shown) =>
              graph.touches.touch({ projectId: at.projectId, shown }).pipe(signedBy(ctx.session), Effect.provide(at.graph)),
          };
          for (const capabilities of [['files'], ['shell'], ['files', 'graph']] as const) {
            const offered: {
              tools: string[];
              messages: readonly Message[];
            }[] = [];
            const runner = yield* scriptedRunner(
              (turn) =>
                turn > 2
                  ? answer(turn, 'Done.')
                  : capabilities[0] === 'shell'
                    ? call(turn, 'bash', { command: 'head -n 1 NOTE.txt' })
                    : call(turn, 'read', { path: 'NOTE.txt' }),
              offered,
            );
            const holdsGraph = capabilities.some((id) => id === 'graph');
            const declaration = holdsGraph ? asAgentDeclaration({ ...tree, capabilities }) : tagma();
            const id = `touch-${capabilities.join('-')}`;
            const view: ThreadView = {
              ...thread,
              id,
              agentId: declaration.id,
              profile: { id, overlay: { id, baseAgentId: declaration.id, description: 'Reads the fixture code.', capabilities } },
            };
            const world = { ...sandboxWorld(), root: demo.demoRoot, world: machineWorld };
            const composed = composeAgent(declaration, runner, undelegatedThreads.rows, undelegatedThreads.mandate, execution, () =>
              Effect.succeed(
                asThreadContext({
                  ...context(world),
                  thread: view,
                  graphRoot: demo.demoRoot,
                  session: { harness: 'tagma', key: id },
                }),
              ),
            );
            const guidance: AgentRuntimeGuidance[] = [];
            const run = yield* launch(composed, {
              ...input(composed, id, [Message.user('Read the fixture twice.')], view),
              sink: {
                push: (event) =>
                  Effect.sync(() => {
                    if (event.type === 'runtime-guidance') guidance.push(event.entry);
                  }),
              },
            });
            yield* run.output.response;
            const touches = guidance.filter((entry) => entry.sources.some((source) => source.ruleId === 'touch'));
            expect(touches, JSON.stringify(offered.at(-1)!.messages.filter((message) => message.role === 'tool'))).toHaveLength(1);
            const delivered = touches[0]!.texts.join('\n');
            expect(delivered).toContain(law);
            expect(delivered).toContain(explanation);
            expect(delivered).toContain(task.title);
            expect(delivered).not.toContain(metadata);
            const messages = JSON.stringify(offered.at(-1)!.messages);
            expect(messages).toContain(law);
            expect(messages).toContain(explanation);
          }
        }),
      ),
    ),
  );
  it.effect(
    'a thread born with navigation on carries its guide in the prompt and hears it once after grepping a member call; off, neither',
    () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const {
              DEFINITIONS,
              prompts,
              instructionWorld,
              composeAgent,
              scriptedRunner,
              sandboxWorld,
              context,
              input,
              tree,
              call,
              answer,
              undelegatedThreads,
              namesOnly,
              launch,
            } = yield* makeComposition(demo);
            const navigator = asAgentDeclaration({ ...tree, id: 'navigator', capabilities: ['files', 'shell', 'navigation'] });
            const guide = DEFINITIONS.find('navigation')?.guide ?? '';
            for (const enabled of [true, false]) {
              yield* instructionWorld.graph.settings.write({
                key: 'navigation.enabled',
                value: enabled,
                projectId: instructionWorld.projectId,
              });
              const runner = yield* scriptedRunner(
                (turn) => (turn <= 2 ? call(turn, 'grep', { pattern: String.raw`store\.get\(` }) : answer(turn, 'Done.')),
                [],
              );
              const composed = composeAgent(navigator, runner, undelegatedThreads.rows, undelegatedThreads.mandate, namesOnly, () =>
                Effect.succeed(context(sandboxWorld())),
              );
              const guidance: AgentRuntimeGuidance[] = [];
              const born = prompts.length;
              const run = yield* launch(composed, {
                ...input(composed, `navigator-${enabled}`, [Message.user('Find the calls of get.')]),
                sink: {
                  push: (event) =>
                    Effect.sync(() => {
                      if (event.type === 'runtime-guidance') guidance.push(event.entry);
                    }),
                },
              });
              yield* run.output.response;
              const cues = guidance.filter((entry) => entry.sources.some((source) => source.ruleId === 'capability-cues'));
              expect(cues).toHaveLength(enabled ? 1 : 0);
              expect(prompts[born]?.includes(guide)).toBe(enabled);
            }
          }),
        ),
      ),
  );
  it.effect('a declaration over files and a shell on the checkout is measured, and holds the commit road and the change record', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
            offers,
            offeredIds,
            capabilityOffers,
            launch,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner(
            (turn) =>
              turn === 1
                ? call(turn, 'write', { path: 'NOTE.txt', content: 'written on the checkout\n' })
                : turn === 2
                  ? call(turn, 'read_changes', {})
                  : answer(turn, 'Done.'),
            offered,
          );
          const checkout: ThreadWorld = checkoutWorld({
            projectRoot: demo.demoRoot,
            scratch: join(root, 'scratch'),
            world: makeMachineWorld(() => null),
          });
          const paths = yield* fixedCheckoutPaths(demo.projectId, [{ checkout: 'demo', root: demo.demoRoot }]);
          const changeRecord = yield* Effect.gen(function* () {
            return yield* changeRecordOf(
              demo.graph.store,
              demo.graph.units,
              paths,
              yield* intakeOf(demo.graph.store, demo.graph.units, yield* Git, paths),
              yield* idleCommands(),
              makeWalks(),
            );
          });
          const checkoutFlights = new CheckoutFlights();
          const onCheckout = (view: ThreadView) =>
            ({
              thread: view,
              world: checkout,
              projectId: demo.projectId,
              projectRoot: demo.demoRoot,
              target: { graph: { projectId: demo.projectId, root: demo.demoRoot } },
              machine: demo.graph.store,
              graph: Effect.succeed(demo.context),
              settings: demo.graph.settings,
              comments: () => commentPolicy().fallback,
              vocabulary: () => shippedVocabulary,
              origin: null,
              identity: sessionIdentity,
              grants: testGrantSigner,
              commandTimes: unruledTimes,
              changeRecord,
              checkoutFlights,
            }) as unknown as ReturnType<typeof asThreadContext>;
          const local: ThreadView = { ...thread, id: 'on-checkout', hostKind: null, hostId: null };
          const records = yield* makeThreadRecords;
          const { store: storage, threads: facets } = yield* threadStack({
            db: demo.graph.store.db,
            units: demo.graph.units,
            records,
            kinds: ENTRY_KINDS,
          });
          const composed = composeAgent(tree, runner, facets.rows, facets.mandate, namesOnly, (view) => Effect.succeed(onCheckout(view)));
          const run = yield* launch(composed, input(composed, 'local', [Message.user('Write, then read.')], local));
          yield* run.output.response;
          expect(offered[0]?.tools).toEqual([
            'ask_user',
            'bash',
            'change_command_limit',
            'check_rules',
            'delete',
            'edit',
            'glob',
            'grep',
            'ls',
            'read',
            'read_changes',
            'read_command',
            'read_command_bytes',
            'read_commands',
            'read_output',
            'rename',
            'search_output',
            'stop_command',
            'submit_work',
            'tool_search',
            'wait_command',
            'write',
          ]);
          const forbidden = asThreadContext({ ...onCheckout(local), comments: () => 'forbid' as const });
          expect(offeredIds('files', forbidden.world.facts, forbidden.comments())).toContain('strip_comments');
          expect(
            offers('files', { world: forbidden.world.facts, comments: forbidden.comments(), images: true }).find(
              (offered) => offered.id === 'strip_comments',
            )?.direct,
          ).toBe(false);
          expect(readFileSync(join(demo.demoRoot, 'NOTE.txt'), 'utf8')).toBe('written on the checkout\n');
          expect(JSON.stringify(offered[2]?.messages)).toContain('NOTE.txt');
          const prompt = prompts.at(-1) ?? '';
          const types = yield* declaredAgents({
            harnesses: Effect.succeed([]),
            storePath: demo.graph.store.path,
            files: agentFilesOf()(DEFINITIONS),
            packages: { agentsIn: () => Effect.succeed([]), agentIn: () => Effect.succeed(undefined) },
          }).pipe(
            Effect.provideService(NativeAgents, yield* registeredAgents([composed], 'test')),
            Effect.provideService(ThreadRecords, records),
            Effect.provideService(Projects, demo.graph.projects),
            Effect.provideService(Settings, demo.graph.settings),
          );
          const sourceCache = Context.get(yield* Layer.build(workspaceInputsLayer(() => [])), WorkspaceInputs);
          const artifacts = yield* versionedShelf(join(demo.demoRoot, 'artifacts'), 'http://localhost');
          const library = yield* agentLibrary({
            types,
            declarations: [tree],
            threads: facets.list,
            records,
            store: storage,
            sourceCache,
            artifacts,
            graphs: {
              graph: demo.context,
              graphFor: () => Effect.succeed(demo.context),
              graphAt: () => Effect.die('a preview opens no thread graph'),
            },
            offers: capabilityOffers,
            world: machineWorld,
            capabilities: DEFINITIONS,
          }).pipe(Effect.provideContext(yield* Layer.build(builtinRegistry)));
          const preview = yield* library.preview(demo.projectId, { id: tree.id });
          expect(preview.prompt.text).toBe(prompt);
        }),
      ),
    ),
  );
  it.effect('the overlay a thread was born with decides its prompt and its set, and never widens either', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
            launch,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner((turn) => answer(turn, 'A story.'), offered);
          const world = sandboxWorld();
          const compose = (declaration: Parameters<typeof composeAgent>[0]) =>
            composeAgent(declaration, runner, undelegatedThreads.rows, undelegatedThreads.mandate, namesOnly, (view: ThreadView) =>
              Effect.succeed({ ...context(world), thread: view }),
            );
          const stories: ThreadView = {
            ...thread,
            id: 'stories',
            agentId: 'declared',
            profile: {
              id: 'stories',
              overlay: {
                id: 'stories',
                baseAgentId: 'declared',
                description: 'Writes a funny story.',
                prompt: 'You write one funny story per message, and nothing else.',
                capabilities: [],
                runtimeSources: [],
              },
            },
          };
          const base = compose({
            id: 'declared',
            name: 'Declared',
            description: 'The base a file agent runs as.',
            identity: 'You are nobody.',
            capabilities: ['files', 'shell', 'web'],
            sources: conversationSources(),
          });
          const told = yield* launch(base, input(base, 'tell', [Message.user('A story, please.')], stories));
          yield* told.output.response;
          expect(offered[0]?.tools).toEqual(['ask_user', 'tool_search']);
          expect(prompts[0]?.startsWith('You write one funny story per message')).toBe(true);
          const narrowed: ThreadView = {
            ...thread,
            id: 'narrowed',
            profile: {
              id: 'files-only',
              overlay: {
                id: 'files-only',
                baseAgentId: 'tree',
                description: 'Files, no shell.',
                capabilities: ['files', 'graph'],
              },
            },
          };
          const cut = compose(tree);
          const read = yield* launch(cut, input(cut, 'read', [Message.user('Read.')], narrowed));
          yield* read.output.response;
          expect(offered[1]?.tools).toEqual(['ask_user', 'delete', 'edit', 'ls', 'read', 'rename', 'tool_search', 'write']);
          expect(prompts[1]?.startsWith('You are the tree agent.')).toBe(true);
          expect(prompts[1]).not.toContain('read_block');
          const stale: ThreadView = {
            ...narrowed,
            id: 'stale',
            profile: {
              id: 'stale',
              overlay: {
                ...narrowed.profile!.overlay,
                id: 'stale',
                sections: [{ edit: 'preamble', find: 'A passage no prompt holds.', with: '' }],
              },
            },
          };
          const refused = yield* Effect.flip(
            Effect.flatMap(launch(cut, input(cut, 'stale', [Message.user('Read.')], stale)), (run) => run.output.response),
          );
          expect(refused).toMatchObject({ cause: { code: 'agent-invalid' } });
          expect(prompts).toHaveLength(2);
        }),
      ),
    ),
  );
  const CHECKOUT: WorldFacts = { shared: true, history: true, network: true };
  const SANDBOX: WorldFacts = { shared: false, history: false, network: false };
  const worlds = [
    [CHECKOUT_WORLD_KIND, CHECKOUT],
    ['sandbox', SANDBOX],
  ] as const;
  const LAWS = COMMENT_POLICIES;
  const catalogs = worlds.flatMap(([name, facts]) => LAWS.map((comments) => [`${name} under ${comments}`, facts, comments] as const));
  it.effect('a capability mounts every operation it declares, and one operation belongs to one capability', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { CAPABILITY_IDS, JOURNALED_OPERATION_IDS, operationCatalog, offeredIds } = yield* makeComposition(demo);
          const agentTool = (id: CatalogOperationId) => operationCatalog.registry.entry(OperationId.make(id)).tool;
          const RUNTIME_SERVED = OPERATION_IDS.filter((id) => agentTool(id)?.runtime === true);
          const UNMOUNTED: ReadonlySet<CatalogOperationId> = new Set<CatalogOperationId>([
            ...OPERATOR_ONLY_OPERATIONS,
            ...RUNTIME_SERVED,
            ...OPERATION_IDS.filter((id) => agentTool(id) === undefined),
          ]);
          const CAPABILITY_OPERATION_IDS = OPERATION_IDS.filter((id) => !UNMOUNTED.has(id));
          for (const [, facts, comments] of catalogs) {
            const owners = new Map<string, string>();
            for (const id of CAPABILITY_IDS) {
              for (const operation of offeredIds(id, facts, comments)) {
                expect(owners.get(operation), `${operation} is mounted by ${owners.get(operation)} and ${id}`).toBeUndefined();
                owners.set(operation, id);
              }
            }
          }
          const nativeIds = new Set<string>(JOURNALED_OPERATION_IDS);
          const native = new Set(
            catalogs
              .flatMap(([, facts, comments]) => CAPABILITY_IDS.flatMap((id) => offeredIds(id, facts, comments)))
              .filter((id) => nativeIds.has(id)),
          );
          expect([...native].sort()).toEqual([...JOURNALED_OPERATION_IDS].filter((id) => !UNMOUNTED.has(id as CatalogOperationId)).sort());
          expect(new Set(offeredIds('mcp', CHECKOUT, 'allowed'))).toEqual(new Set<string>(MCP_OPERATION_IDS));
          expect(offeredIds('shell', CHECKOUT, 'allowed')).toContain(SUBMIT_OPERATION);
          const session = new Set(offeredIds('threads', CHECKOUT, 'allowed'));
          expect([...session].sort()).toEqual(
            [
              ...THREAD_OPERATION_IDS().filter((id) => !UNMOUNTED.has(id as CatalogOperationId)),
              ...Object.keys(FOLDER_OPERATIONS),
              ...Object.keys(NOTE_OPERATIONS),
              ...Object.keys(ATTENTION_OPERATIONS),
              ...SEARCH_OPERATION_IDS,
              ...CONTEXT_OPERATION_IDS,
              ...HARNESS_OPERATION_IDS,
              ...CALL_OPERATION_IDS,
            ].sort(),
          );
          const everywhere = new Set(
            catalogs.flatMap(([, facts, comments]) => CAPABILITY_IDS.flatMap((id) => offeredIds(id, facts, comments))),
          );
          expect([...everywhere].sort()).toEqual([...CAPABILITY_OPERATION_IDS].sort());
          const doorsOf = (id: string) => operationCatalog.registry.doors(OperationId.make(id));
          const overMcp: string[] = OPERATION_IDS.filter((id) => doorsOf(id).includes('mcp'));
          const overHttp = [...everywhere, ...RUNTIME_SERVED].filter((id) => doorsOf(id).includes('http'));
          expect([...overMcp].sort()).toEqual(overHttp.sort());
          const panelActs = new Set([
            'stage_checkout',
            'unstage_checkout',
            'discard_checkout',
            'commit_checkout',
            'abort_checkout',
            'fetch_checkout',
            'pull_checkout',
            'push_checkout',
          ]);
          for (const id of new Set([...everywhere, ...overMcp])) {
            expect(panelActs.has(id), `${id} is a checkout panel act`).toBe(false);
            expect(operationCatalog.registry.callers(OperationId.make(id))).not.toBe('operator');
          }
          for (const id of ['read_checkout', 'read_checkout_history', 'read_commit', 'read_repositories']) {
            expect(everywhere.has(id)).toBe(true);
            expect(overMcp.includes(id)).toBe(true);
          }
          const byDefault = new Set(worlds.flatMap(([, facts]) => CAPABILITY_IDS.flatMap((id) => offeredIds(id, facts, 'allowed'))));
          expect(byDefault.has(SWEEP_OPERATION)).toBe(false);
        }),
      ),
    ),
  );
  it.effect('a thread holding the graph is offered the command rule operations, and the shell mounts the rule section in its turn', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { DEFINITIONS, offeredIds } = yield* makeComposition(demo);
          const offered = offeredIds('graph', CHECKOUT, 'allowed');
          expect(COMMAND_RULE_OPERATION_IDS.filter((id) => !offered.includes(id))).toEqual([]);
          const notes =
            DEFINITIONS.find('shell')!.turnNote?.(asThreadContext({ machine: {}, projectId: 1, thread: { id: 'thread-1' } })) ?? [];
          expect(notes.map((note) => note.id)).toContain('command-rules');
        }),
      ),
    ),
  );
  it.effect("the tagma agent without the graph carries the tree law of its world and none of the graph, in the doctrine's order", () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { DEFINITIONS, DOCTRINE, sectionsOf } = yield* makeComposition(demo);
          const held = tagma().capabilities;
          const executor = { ...tagma(), capabilities: held === 'every' ? held : held.filter((id) => id !== 'graph') };
          const onCheckout = sectionsOf(executor, CHECKOUT);
          const inSandbox = sectionsOf(executor, SANDBOX);
          const graphSections = capabilitySections()(DEFINITIONS.find('graph')!, SANDBOX);
          expect(onCheckout).toEqual(expect.arrayContaining(['typed-tools', 'the-shared-checkout', 'commits']));
          expect(inSandbox).toContain('the-sandbox-tree');
          expect(inSandbox).not.toContain('the-shared-checkout');
          for (const id of graphSections) {
            expect(onCheckout).not.toContain(id);
            expect(inSandbox).not.toContain(id);
          }
          const render = {
            world: { root: '/work', shell: '/bin/sh', platform: 'linux' },
            contributed: DOCTRINE.contributed,
            facts: { config: true },
          };
          const document = promptDocument({ agentId: executor.id, identity: executor.identity, sections: new Set(onCheckout), render });
          const expected = DOCTRINE.contributed.assemblies.prompt.filter(
            (id) => onCheckout.includes(id) || DOCTRINE.contributed.assemblies.base.includes(id),
          );
          expect(document.sections.map((section) => section.id)).toEqual(expected);
        }),
      ),
    ),
  );
  const mcpOnly = asAgentDeclaration({
    id: 'mcp-only',
    name: 'Mcp',
    description: 'An agent over the project servers and nothing else.',
    identity: 'You are the servers agent.',
    capabilities: ['mcp'],
    sources: conversationSources(),
  });
  const downPool = (message: string) => ({
    reconcile: () => Effect.fail(new EffectDrizzleQueryError({ query: 'reconcile', params: [], cause: new Error(message) })),
  });
  const orientingThreads = {
    rows: {
      worldStateSnapshot: () => Effect.succeed({ snapshot: {}, checkpointId: null }),
      latestCompactionCheckpointId: () => Effect.succeed('ckpt-1'),
      advanceWorldState: () => Effect.void,
      advanceGraphCursor: () => Effect.void,
    },
    mandate: { delegationLineage: () => Effect.succeed({ own: null, nearest: null }) },
  } as unknown as ThreadParts;
  it.effect('a capability whose preparation fails is withheld with its reason told, and the turn lives', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner((turn) => answer(turn, 'Done.'), offered);
          const composed = composeAgent(mcpOnly, runner, orientingThreads.rows, orientingThreads.mandate, namesOnly, () =>
            Effect.succeed(mcpContext(downPool('connection refused'))),
          );
          const started = input(composed, 'served', [Message.user('Hi.')]);
          const prepared = yield* composed.prepare(started);
          const run = yield* prepared.start(started);
          yield* run.output.response;
          expect(offered[0]?.tools).toEqual(['ask_user', 'tool_search']);
          const catalog = yield* composed.toolCatalog({ thread, run: started.run, supply: started.supply });
          expect(Object.keys(catalog).sort()).toEqual(['ask_user', 'tool_search']);
          const oriented = yield* prepared.orient(thread);
          const part =
            (
              oriented?.message as {
                readonly content?: readonly {
                  readonly text?: string;
                }[];
              }
            )?.content?.[0]?.text ?? '';
          expect(part).toContain('`mcp` is unavailable');
          expect(part).toContain('"Failed query: reconcile"');
          expect(part).toContain('withheld');
        }),
      ),
    ),
  );
  it.effect('a thread whose project graph refuses to open still runs, with the graph withheld and the refusal told', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner((turn) => answer(turn, 'Done.'), offered);
          const refused = new GateRefusal(
            'graph-pool',
            'BlockTreeError at /trees/shop/tags/index.md: frontmatter-yaml: Multiline implicit key',
            ['repair the graph file or layout at /trees/shop/tags/index.md, then retry the operation'],
          );
          const composed = composeAgent(
            { ...mcpOnly, id: 'graph-only', capabilities: ['graph'] },
            runner,
            orientingThreads.rows,
            orientingThreads.mandate,
            namesOnly,
            () => Effect.succeed(asThreadContext({ ...mcpContext({ reconcile: () => Effect.void }), graphRefused: refused })),
          );
          const started = input(composed, 'served', [Message.user('Hi.')]);
          const prepared = yield* composed.prepare(started);
          const run = yield* prepared.start(started);
          yield* run.output.response;
          expect(offered[0]?.tools).toEqual(['ask_user', 'tool_search']);
          const oriented = yield* prepared.orient(thread);
          const part =
            (
              oriented?.message as {
                readonly content?: readonly {
                  readonly text?: string;
                }[];
              }
            )?.content?.[0]?.text ?? '';
          expect(part).toContain('graph-pool');
          expect(part).toContain('/trees/shop/tags/index.md');
        }),
      ),
    ),
  );
  it.effect("a server's tools are deferred behind tool_search, named with the turn, and revealed by a search", () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
          } = yield* makeComposition(demo);
          const offered: {
            tools: string[];
            active?: string[] | undefined;
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner(
            (turn) => (turn === 1 ? call(turn, 'tool_search', { query: 'select:mcp__files__search' }) : answer(turn, 'Done.')),
            offered,
          );
          const palette: ReturnType<McpServers['Service']['palette']> = [
            {
              declaration: {
                name: 'files',
                transport: 'stdio',
                command: 'echo',
                capabilities: { kinds: [], mutates: false },
                enabled: true,
              },
              descriptors: [{ name: 'search', inputSchema: { type: 'object', properties: {}, required: [] } }] as never,
            },
          ];
          const withServers = (view: ThreadView) =>
            ({
              thread: view,
              world: sandboxWorld(),
              projectId: demo.projectId,
              projectRoot: demo.demoRoot,
              target: { graph: { projectId: demo.projectId, root: demo.demoRoot } },
              machine: demo.graph.store,
              graph: Effect.succeed(demo.context),
              settings: demo.graph.settings,
              comments: () => commentPolicy().fallback,
              vocabulary: () => shippedVocabulary,
              origin: null,
              mcpServers: { reconcile: () => Effect.void, caller: () => ({ call: () => Effect.die('no call in this case') }) },
              workingRoot: demo.demoRoot,
              caller: {
                actor: { kind: 'operator' },
                files: { path: join(root, 'scratch'), resolve: (path: string) => join(root, 'scratch', path) },
              },
              mcp: () => palette,
              mcpBound: mcpBoundTools(),
            }) as unknown as ReturnType<typeof asThreadContext>;
          const composed = composeAgent(mcpOnly, runner, orientingThreads.rows, orientingThreads.mandate, namesOnly, (view) =>
            Effect.succeed(withServers(view)),
          );
          const started = input(composed, 'servers', [Message.user('Search the files.')]);
          const prepared = yield* composed.prepare(started);
          const run = yield* prepared.start(started);
          yield* run.output.response;
          expect(offered[0]?.tools).toContain('mcp__files__search');
          expect(offered[0]?.tools).toEqual(expect.arrayContaining([...MCP_OPERATION_IDS]));
          expect(offered[0]?.active).toEqual(['tool_search']);
          expect(offered[1]?.active).toEqual(['mcp__files__search', 'tool_search']);
          const oriented = yield* prepared.orient(thread);
          const part =
            (
              oriented?.message as {
                readonly content?: readonly {
                  readonly text?: string;
                }[];
              }
            )?.content?.[0]?.text ?? '';
          expect(part).toContain('- mcp__files__search');
          expect(part).toContain('tool_search');
        }),
      ),
    ),
  );
  it.effect("a runtime source's deferred tool is named in the turn's inventory and revealed by a search", () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { composeAgent, scriptedRunner, input, thread, call, answer, namesOnly, mcpContext, registry } =
            yield* makeComposition(demo);
          yield* registry.register({
            id: 'probe',
            owner: 'fixture',
            names: ['probe_lookup'],
            offer: () =>
              Effect.succeed({
                id: 'probe',
                tools: {
                  probe_lookup: Tool.make({
                    display: () => ({ form: 'none' }),
                    approval: ASKS_NEVER,
                    description: 'Look a probe up.',
                    parameters: Schema.Struct({}),
                    exposure: 'deferred',
                  }),
                },
              }),
          });
          const offered: {
            tools: string[];
            active?: string[] | undefined;
            messages: readonly Message[];
          }[] = [];
          const runner = yield* scriptedRunner(
            (turn) => (turn === 1 ? call(turn, 'tool_search', { query: 'select:probe_lookup' }) : answer(turn, 'Done.')),
            offered,
          );
          const composed = composeAgent(
            { ...mcpOnly, id: 'probing', capabilities: [], sources: [...conversationSources(), 'probe'] },
            runner,
            orientingThreads.rows,
            orientingThreads.mandate,
            namesOnly,
            () => Effect.succeed(mcpContext({ reconcile: () => Effect.void })),
          );
          const started = input(composed, 'probing', [Message.user('Look it up.')]);
          const prepared = yield* composed.prepare(started);
          const run = yield* prepared.start(started);
          yield* run.output.response;
          expect(offered[0]?.active).toEqual(['tool_search']);
          expect(offered[1]?.active).toEqual(['probe_lookup', 'tool_search']);
          const oriented = yield* prepared.orient(thread);
          const part =
            (
              oriented?.message as {
                readonly content?: readonly {
                  readonly text?: string;
                }[];
              }
            )?.content?.[0]?.text ?? '';
          expect(part).toContain('- probe_lookup');
        }),
      ),
    ),
  );
  it.effect('capability losses change the world snapshot once per change and recover when the pool returns', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
          } = yield* makeComposition(demo);
          const loss = (reason: string) => capabilityUnavailable({ capability: 'mcp', reason });
          const first = yield* renderWorldState([capabilityLossSection([loss('the pool is down')], describedAs)], {});
          expect(first.kind).toBe('changed');
          if (first.kind !== 'changed') return;
          const again = yield* renderWorldState([capabilityLossSection([loss('the pool is down')], describedAs)], first.snapshot);
          expect(again.kind).toBe('unchanged');
          const changed = yield* renderWorldState(
            [capabilityLossSection([loss('the pool is down'), loss('the pool moved')], describedAs)],
            first.snapshot,
          );
          expect(changed.kind).toBe('changed');
          if (changed.kind !== 'changed') return;
          const recovered = yield* renderWorldState([capabilityLossSection([], describedAs)], changed.snapshot);
          expect(recovered.kind).toBe('changed');
        }),
      ),
    ),
  );
  it.effect(
    'model boundaries deliver complete instruction revisions, preserve them on continuation, and restore them after compaction',
    () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const {
              DEFINITIONS,
              CAPABILITY_IDS,
              DOCTRINE,
              JOURNALED_OPERATION_IDS,
              root,
              prompts,
              instructionWorld,
              composeAgent,
              scriptedRunner,
              sandboxWorld,
              context,
              input,
              thread,
              tree,
              call,
              answer,
              undelegatedThreads,
              namesOnly,
              describedAs,
              sectionsOf,
              mcpContext,
              searched,
              launch,
            } = yield* makeComposition(demo);
            const { graph, projectId } = instructionWorld;
            const tag = yield* graph.blocks.create({
              projectId,
              tags: ['tag'],
              title: 'Case',
              body: 'Initial case guidance.',
              fields: { id: 'case' },
            });
            const law = yield* graph.blocks.create({ projectId, tags: ['rule'], title: 'Preserve the fixture data' });
            const initial = yield* graph.orientation.instructions({ projectId, audience: 'graph' });
            const expected: InstructionSet[] = [initial];
            const offered: {
              tools: string[];
              messages: readonly Message[];
            }[] = [];
            const runner = yield* scriptedRunner(
              (turn) =>
                Effect.gen(function* () {
                  if (turn === 1) {
                    yield* graph.blocks.update({ id: tag.id, body: 'Revised case guidance.' });
                    expected.push(yield* graph.orientation.instructions({ projectId, audience: 'graph' }));
                  }
                  if (turn === 2) {
                    yield* graph.blocks.setEnabled({ id: law.id, enabled: false });
                    expected.push(yield* graph.orientation.instructions({ projectId, audience: 'graph' }));
                  }
                  return turn < 4 ? call(turn, 'read', { path: 'NOTE.txt' }) : answer(turn, 'Done.');
                }).pipe(Effect.provide(demo.context), Effect.orDie),
              offered,
            );
            const declaration = asAgentDeclaration({ ...tree, capabilities: ['files', 'graph'] });
            const table = yield* instructionWorld.table();
            const composed = composeAgent(declaration, runner, undelegatedThreads.rows, undelegatedThreads.mandate, namesOnly, (view) =>
              Effect.succeed(
                asThreadContext({
                  ...context(sandboxWorld()),
                  thread: view,
                  vocabulary: () => table,
                  target: { graph: { projectId, root: instructionWorld.demoRoot } },
                  session: { harness: 'tagma', key: view.id },
                }),
              ),
            );
            const guidance: AgentRuntimeGuidance[] = [];
            const sink: AgentSink = {
              push: (event) =>
                Effect.sync(() => {
                  if (event.type === 'runtime-guidance') guidance.push(event.entry);
                }),
            };
            const first = yield* launch(composed, { ...input(composed, 'revisions', [Message.user('Read the fixture.')]), sink });
            yield* first.output.response;
            expect(offered.map((entry) => instructionSnapshot(entry.messages, projectId))).toEqual([
              expected[0],
              expected[1],
              expected[2],
              expected[2],
            ]);
            expect(guidance.flatMap((entry) => entry.sources).filter((source) => source.ruleId === 'project-instructions')).toHaveLength(3);
            const prior = offered.at(-1)!.messages;
            guidance.length = 0;
            const continued = yield* launch(composed, { ...input(composed, 'continued', prior), sink });
            yield* continued.output.response;
            expect(guidance.flatMap((entry) => entry.sources).filter((source) => source.ruleId === 'project-instructions')).toEqual([]);
            const compacted = new Message({
              role: 'user',
              content: [{ type: 'text', text: 'Retained task summary.' }],
              compaction: { id: 'context-reset', mode: 'manual', transcriptLocation: root, preservedCount: 0 },
            });
            const reset = yield* launch(composed, { ...input(composed, 'reset', [...prior, compacted]), sink });
            yield* reset.output.response;
            expect(instructionSnapshot(offered.at(-1)!.messages, projectId)).toEqual(expected[2]);
            expect(guidance.flatMap((entry) => entry.sources).filter((source) => source.ruleId === 'project-instructions')).toHaveLength(1);
          }),
        ),
      ),
  );
  const providerWeb: ServedWeb = {
    tools: {
      websearch: {
        input: Schema.Struct({ query: Schema.String }),
        wire: {
          vendor: { name: 'run', namespace: { name: 'web', description: 'Web.' } },
          description: 'Search.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        },
        reads: () => false,
        targets: () => ({ queries: [], pages: [] }),
        run: () => Effect.succeed('found'),
      },
    },
  };
  it.effect(
    'a thread that searches with the web of its provider is offered the tools the provider declares directly, and Tagma keeps its own behind tool_search otherwise',
    () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const {
              DEFINITIONS,
              CAPABILITY_IDS,
              DOCTRINE,
              JOURNALED_OPERATION_IDS,
              root,
              prompts,
              instructionWorld,
              composeAgent,
              scriptedRunner,
              sandboxWorld,
              context,
              input,
              thread,
              tree,
              call,
              answer,
              undelegatedThreads,
              namesOnly,
              describedAs,
              sectionsOf,
              mcpContext,
              searched,
            } = yield* makeComposition(demo);
            const tagma = yield* searched({ source: 'tagma' });
            expect(tagma.tools).toContain('websearch');
            expect(tagma.tools).toContain('webfetch');
            expect(tagma.active).not.toContain('websearch');
            expect(tagma.active).not.toContain('webfetch');
            const vendor = yield* searched({
              source: 'vendor',
              web: providerWeb,
              memory: () => ({ page: () => undefined, keep: () => undefined, allowed: () => false, allow: () => undefined }),
            });
            expect(vendor.tools).toContain('websearch');
            expect(vendor.tools).not.toContain('webfetch');
            expect(vendor.active ?? vendor.tools).toContain('websearch');
          }),
        ),
      ),
  );
  it.effect('a thread whose provider runs its own loop is offered no web at all, since that loop brings it', () =>
    withDemo((demo) =>
      Effect.scoped(
        Effect.gen(function* () {
          const {
            DEFINITIONS,
            CAPABILITY_IDS,
            DOCTRINE,
            JOURNALED_OPERATION_IDS,
            root,
            prompts,
            instructionWorld,
            composeAgent,
            scriptedRunner,
            sandboxWorld,
            context,
            input,
            thread,
            tree,
            call,
            answer,
            undelegatedThreads,
            namesOnly,
            describedAs,
            sectionsOf,
            mcpContext,
            searched,
          } = yield* makeComposition(demo);
          const hosted = yield* searched({ source: 'hosted' });
          expect(hosted.tools).not.toContain('websearch');
          expect(hosted.tools).not.toContain('webfetch');
        }),
      ),
    ),
  );
});
