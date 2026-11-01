import { unthreadedCaller } from '../callers';
import { sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { basename } from 'node:path';
import { ToolAnswer, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { type Message } from '@runlith/llm/schema/messages';
import { CpuProfiles } from '@runlith/performance/CpuProfiles';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { openToolDoor, ToolJudge } from '@runlith/agent/door/openToolDoor';
import { builtinMode } from '../modes.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { McpSignInDoor } from '../../../mcp/contract/service/door.js';
import { localSignInDoor } from '../../http/signInDoor.js';
import { mcpServersLayer } from '../../../mcp/testing/doubles.js';
import { Tags } from '../../../graph/contract/service/vocabulary.js';
import { type EffectDemo, graphFixture, tempRootEffect, zoneDeclared } from '../graphFixture.js';
import type { Caller, FileReach } from '../../../platform/contract/wire/caller.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { fixedCheckoutPaths } from '../../../workspace/testing/doubles.js';
import type { TagTable } from '../../../graph/contract/wire/tags/table.js';
import type { CatalogOperationId } from '../catalog.js';
import { fixtureNativeCatalog as nativeCatalog, fixtureServedGraphs } from '../nativeCatalog.js';
import { RoutedGraphs } from '../../../graph/contract/service/serving.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { NO_RULES } from '../../../enforcement/testing/doubles.js';
import { threadScratch } from '../../../threads/testing/doubles.js';
import { threadStore, CORE_KINDS } from '../../../native-harness/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { WorldFiles } from '../../../executions/contract/service/worlds.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { routedSeams } from '../../../graph/testing/doubles.js';

export type GraphToolContext = {
  readonly graph: EffectDemo['context'];
  readonly projectId: number;
  readonly projectName: string;
  readonly graphRoot: string;
  readonly scratch: FileReach;
  readonly workingRoot: string;
  readonly mcpServers: McpServers['Service'];
  readonly session: { readonly harness: string; readonly key: string };
  readonly ownerId: string;
  readonly vocabulary: () => TagTable;
  readonly performance: PerformanceReports['Service'];
  readonly profiles: CpuProfiles['Service'];
  readonly refused?: GateRefusal;
};

const GRAPH_OPERATION_IDS = [
  'add_mcp_server',
  'anchor_block',
  'answer_reflection',
  'apply_batch',
  'capture_performance_profile',
  'claim_block',
  'close_block',
  'create_block',
  'delete_block',
  'edit_block',
  'file_reflection',
  'finish_block',
  'link_blocks',
  'query_blocks',
  'read_block',
  'read_events',
  'read_gauges',
  'read_journal',
  'read_mcp_servers',
  'read_owners',
  'read_performance',
  'read_reflections',
  'read_settings',
  'read_tags',
  'read_zone',
  'ready_work',
  'reanchor_path',
  'release_block',
  'remove_mcp_server',
  'search_blocks',
  'set_rule_delivery',
  'set_rule_enabled',
  'supersede_block',
  'unanchor_block',
  'unanswer_reflection',
  'unlink_blocks',
  'update_block',
  'write_setting',
] as const satisfies readonly CatalogOperationId[];

const graphCatalog = Effect.fnUntraced(function* (context: GraphToolContext) {
  const caller: Caller = {
    actor: {
      kind: 'thread',
      threadId: context.session.key,
      projectId: context.projectId,
      principalId: context.ownerId,
      session: context.session,
    },
    files: context.scratch,
  };
  const pool = fixtureServedGraphs(context.graph);
  const owners = Context.merge(
    Context.merge(Context.add(context.graph, RoutedGraphs, pool), routedSeams(context.graph, pool)),
    Context.empty().pipe(
      Context.add(McpServers, context.mcpServers),
      Context.add(McpSignInDoor, localSignInDoor(undefined)),
      Context.add(CpuProfiles, context.profiles),
      Context.add(PerformanceReports, context.performance),
      Context.add(WorldFiles, { files: BunFileSystem.layer }),
      Context.add(CheckoutPaths, yield* fixedCheckoutPaths(context.projectId, [{ checkout: 'graph', root: context.graphRoot }])),
    ),
  );
  return yield* nativeCatalog(
    {
      place: { root: context.workingRoot, origin: null },
      caller,
      project: { id: context.projectId, name: context.projectName },
      vocabulary: context.vocabulary,
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: context.graphRoot,
      refused: context.refused,
      owners: Context.add(owners, RuleChecks, NO_RULES).pipe(Context.add(OperationChecks, operationChecks(NO_RULES))),
    },
    GRAPH_OPERATION_IDS,
  );
});

const payload = (answer: unknown) => (answer instanceof ToolAnswer ? answer.value : answer) as Record<string, unknown>;

const makeGraphTools = Effect.fnUntraced(function* ({
  demo,
  projectId = demo.project('tools').id,
  mcpServers,
}: {
  demo: EffectDemo;
  projectId?: number;
  mcpServers?: McpServers['Service'];
}) {
  const files = yield* FileSystem.FileSystem;
  const project = yield* demo.graph.projects.byId(projectId);
  if (project.rootPath === null) return yield* Effect.die('The native tool fixture needs a checkout.');
  const root = yield* files.realPath(project.rootPath);
  const mcp = mcpServers ?? Context.get(yield* Layer.build(mcpServersLayer({})), McpServers);
  const scratch = yield* threadScratch(yield* files.realPath(yield* tempRootEffect(demo.fixture, 'tagma-scratch-')));
  yield* scratch.ensure('thread-1');
  const vocabulary = yield* (yield* Tags).reader(projectId);
  const ctx: GraphToolContext = {
    graph: demo.context,
    projectId,
    projectName: project.name,
    graphRoot: root,
    scratch: scratch.scope('thread-1'),
    workingRoot: yield* files.realPath(demo.demoRoot),
    vocabulary,
    mcpServers: mcp,
    session: { harness: 'tagma', key: 'thread-1' },
    ownerId: 'owner-1',
    performance: PerformanceReports.of({
      read: () =>
        Effect.succeed({
          type: 'stalls',
          inheritedDrops: 0,
          sessionDrops: 0,
          inheritedDroppedKinds: {},
          sessionDroppedKinds: {},
          retainedRange: null,
          stalls: [],
          next: null,
        }),
    }),
    profiles: CpuProfiles.of({
      capture: (request) =>
        Effect.succeed({
          record: {
            id: 'captured-profile',
            kind: 'profile',
            instanceId: 'process',
            wallTime: 100,
            monotonicStart: 10,
            monotonicEnd: 20,
            payload: {
              ...request,
              profile: {
                nodes: [{ id: 1, callFrame: { functionName: 'captured', url: '' } }],
                startTime: 10,
                endTime: 20,
                samples: [],
                timeDeltas: [],
              },
            },
          },
          cuts: [],
        }),
      diagnostics: () => ({ active: null, pending: 0 }),
    }),
  };
  const catalog = yield* graphCatalog(ctx);
  const catalogFor = (context: GraphToolContext) => (context === ctx ? Effect.succeed(catalog) : graphCatalog(context));
  let calls = 0;
  const answerWith = Effect.fnUntraced(function* (
    context: GraphToolContext,
    name: string,
    input: Record<string, unknown>,
    messages: readonly Message[] = [],
    key?: string,
  ) {
    const entry = (yield* catalogFor(context))[name];
    if (entry === undefined) return yield* Effect.die(`The catalog has no ${name}.`);
    const execute = toolExecute(entry);
    if (execute === null) return yield* Effect.die(`The tool ${name} has no execute.`);
    const toolCallId = key ?? `fixture:${projectId}:${++calls}`;
    const prepared = yield* toolPrepare(entry)?.(input, { toolCallId, caller: unthreadedCaller }) ?? Effect.succeed(undefined);
    return yield* execute(input, { toolCallId, caller: unthreadedCaller, messages, prepared: prepared?.prepared });
  });
  const answer = (name: string, input: Record<string, unknown>, messages: readonly Message[] = []) =>
    answerWith(ctx, name, input, messages);
  const call = (name: string, input: Record<string, unknown>, messages: readonly Message[] = []) =>
    Effect.map(answer(name, input, messages), payload);
  const form = Effect.fnUntraced(function* (name: string, input: Record<string, unknown>) {
    const answered = yield* answer(name, input);
    if (!(answered instanceof ToolAnswer) || answered.display === undefined) return yield* Effect.die(`The tool ${name} answered no form.`);
    return answered.display;
  });
  const modelText = Effect.fnUntraced(function* (name: string, input: Record<string, unknown>) {
    const answered = yield* answer(name, input);
    if (!(answered instanceof ToolAnswer) || answered.text === undefined)
      return yield* Effect.die(`The tool ${name} answered no model text.`);
    return answered.text;
  });
  return {
    demo,
    graph: demo.graph,
    root,
    scratch,
    ctx,
    rootName: Effect.fnUntraced(function* (at: number = projectId) {
      return yield* demo.nameOf((yield* demo.graph.blocks.rootBlockOf(at)).id);
    }),
    graphCatalog: catalogFor,
    answer,
    call,
    tableOf: (world: EffectDemo, id: number) => world.graph.tags.of(id),
    answerWith: (context: GraphToolContext, name: string, input: Record<string, unknown>) =>
      Effect.map(answerWith(context, name, input), payload),
    callAt: (key: string, name: string, input: Record<string, unknown>) => Effect.map(answerWith(ctx, name, input, [], key), payload),
    form,
    modelText,
    nativeCall: (name: string, input: Record<string, unknown>, context: GraphToolContext = ctx) =>
      Effect.acquireUseRelease(
        Effect.sync(() => openToolDoor('run-native', unthreadedCaller, {}, new ToolJudge(builtinMode('trust')))),
        (door) =>
          Effect.gen(function* () {
            const tool = (yield* catalogFor(context))[name];
            if (tool === undefined) return yield* Effect.die(`The catalog has no ${name}.`);
            const toolCallId = `fixture:${projectId}:${++calls}`;
            const verdict = yield* door.verdict({ name, input, tool, toolCallId });
            const outcome = yield* door.settle({
              name,
              input,
              tool,
              confirmed: verdict.verdict === 'ask' ? true : undefined,
              options: { toolCallId, messages: [] },
            });
            return outcome.output as Record<string, unknown>;
          }),
        (door) => door.close(),
      ),
  };
});

export class GraphTools extends Context.Service<GraphTools, Effect.Success<ReturnType<typeof makeGraphTools>>>()('testing/GraphTools') {}

export const graphToolsFixture = Layer.effectContext(
  Effect.gen(function* () {
    const fixture = graphFixture({ projects: ['tools'] });
    const demo = (yield* Effect.acquireRelease(fixture.openEffect(), () => Effect.orDie(fixture.releaseEffect))).effects;
    return yield* Effect.provide(
      Effect.gen(function* () {
        const records = yield* makeThreadRecords;
        const threads = yield* threadStore(records, CORE_KINDS);
        yield* threads.insert({ id: 'thread-1', ownerId: 'owner-1', agentId: 'tagma' });
        return Context.add(demo.context, GraphTools, yield* makeGraphTools({ demo }));
      }),
      demo.context,
    );
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));

export const withGraphTools =
  <Eff extends Effect.Effect<unknown, unknown, unknown>, A>(body: () => Generator<Eff, A, never>) =>
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { demo, graph, ctx } = yield* GraphTools;
        const root = yield* tempRootEffect(demo.fixture, 'native-case-');
        const project = yield* graph.projectLifecycle.create({ name: basename(root), rootPath: root });
        yield* zoneDeclared(project.id);
        const world = yield* makeGraphTools({ demo, projectId: project.id, mcpServers: ctx.mcpServers });
        return yield* Effect.provideService(Effect.gen(body), GraphTools, world);
      }),
    );
