import { layer } from '@runlith/effect-test';
import { fixtureMigrations } from '../migrations.js';
import { servedCapabilities } from '../native-harness/capabilities.js';
import { expect } from 'bun:test';
import { kind, world } from '@runlith/testbed/worlds';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { dockerSuite } from '../../../sandbox/testing/doubles.js';
import { join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { type AgentRunner, makeAgentRunner } from '@runlith/agent/AgentRunner';
import { RunStop } from '@runlith/agent/RunStop';
import type { AgentToolOutputs } from '@runlith/agent/ToolOutput';
import type { ModelRequestInput, ModelStreamInput } from '@runlith/agent/modelPort';
import type { ThreadRow } from '@runlith/agent/thread/rows';
import type { ThreadAgent, ThreadPrepareInput, ThreadRunInput, ThreadView } from '@runlith/agent/thread/agents/ThreadAgent';
import { noSources } from '@runlith/agent/thread/conformance/agents';
import { Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { Usage, type LLMEvent } from '@runlith/llm/schema/events';
import { Clock, Context, Effect, FileSystem, Layer, Stream } from 'effect';
import { builtinMode } from '../modes.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { seededStoreLayer } from '../../../platform/store/open.js';
import { project } from '../../../projects/testing/doubles.js';
import { scopeRecord } from '../../../thread-record/testing/records.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import { contributions, SECTIONS as threadSections, threadResourceStore } from '../../../threads/testing/doubles.js';
import { sandboxHolds, teamLess } from '../../../threads/testing/doubles.js';
import {
  type ThreadStore,
  asAgentDeclaration,
  composeAgent,
  asThreadContext,
  conversationSources,
} from '../../../native-harness/testing/doubles.js';
import { dockerPreparation } from '../../../sandbox/testing/doubles.js';
import { dockerGuests } from '../../../sandbox/testing/doubles.js';
import type { GuestBackend } from '../../../sandbox/contract/service/backends.js';
import { dockerSaid } from '../../../sandbox/testing/doubles.js';
import { preparedTreeStore } from '../../../sandbox/testing/doubles.js';
import { GuestWorlds } from '../../../sandbox/contract/service/guests.js';
import { preparedTreesService } from '../../../sandbox/testing/doubles.js';
import { sandboxStore } from '../../../sandbox/testing/doubles.js';
import { Sandboxes } from '../../../sandbox/contract/service/sandboxes.js';
import { PreparedTrees } from '../../../sandbox/contract/service/preparedTrees.js';
import { SandboxHolds } from '../../../sandbox/contract/service/holds.js';
import { sandboxServices } from '../../../sandbox/testing/doubles.js';
import { nativeDoor, nativeOffers } from '../../../invocation/testing/native.js';
import { fixtureOperationCatalog as operationCatalog } from '../nativeCatalog.js';
import { callLifetimes } from '../../callLifetimes.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
import { BEHAVIOUR_REGISTRY } from '../../manifest.js';
import { theSandboxTree } from '../../../sandbox/doctrine/theSandboxTree.js';
import { unruledTimes } from '@runlith/agent-tools/CommandWork';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { ChangeRecord } from '../../../change-record/contract/service/record.js';
import { SandboxFiles } from '../../../sandbox/contract/service/files.js';
import { Git } from '@runlith/git/Git';
import { CommitHooks } from '../../../enforcement/commits/hooks.js';
import { CacheWarmth } from '../../../threads/contract/service/evidence.js';
import { quiet, workerLanes } from '../../../enforcement/testing/wiring.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { NO_RULES } from '../../../enforcement/testing/doubles.js';
import { operationChecks } from '../../operationChecks.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { commentPolicy } from '../../../graph/testing/doubles.js';
import { threadStack, type ThreadParts } from '../threadParts.js';
import type { Worlds } from '../../../executions/contract/service/worlds.js';
import { leasedWorlds } from '../../../executions/testing/doubles.js';
import { ENTRY_KINDS, NATIVE_AGENT_RULES } from '../../manifest.js';
import { AgentRuleRegistry } from '@runlith/agent/AgentRuntimePolicy';
const ruleRegistry = new AgentRuleRegistry(NATIVE_AGENT_RULES);
const tree = asAgentDeclaration({
  id: 'tree',
  name: 'Tree',
  description: 'An agent over a tree and nothing else.',
  identity: 'You are the tree agent.',
  capabilities: ['files', 'shell'],
  sources: conversationSources(),
});
const host = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const platform = Layer.mergeAll(host, BunChildProcessSpawner.layer.pipe(Layer.provide(host)));
const makeFixture = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const checkout = yield* files.makeTempDirectoryScoped({ prefix: 'sandbox-world-source-' });
  const exports = yield* files.makeTempDirectoryScoped({ prefix: 'sandbox-world-exports-' });
  yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
  yield* files.makeDirectory(join(checkout, '.tagma'), { recursive: true });
  yield* files.writeFileString(join(checkout, 'src/answer.txt'), 'the committed tree\n');
  yield* files.writeFileString(join(checkout, '.tagma/block.md'), 'graph content\n');
  const git = Effect.fnUntraced(function* (...args: string[]) {
    const ran = yield* spawnedEffect(['git', '-C', checkout, ...args], { env: process.env });
    if (!ran.success) return yield* Effect.die(new Error(`git ${args.join(' ')} failed: ${ran.stderr.toString()}`));
    return ran.stdout.toString();
  });
  yield* git('init', '-q');
  yield* git('add', '.');
  yield* git('-c', 'user.email=fixture@tagma', '-c', 'user.name=fixture', 'commit', '-q', '-m', 'first');
  const head = (yield* git('rev-parse', 'HEAD')).trim();
  yield* files.writeFileString(join(checkout, 'src/uncommitted.txt'), 'never in a snapshot\n');
  const hostSentinel = join(checkout, 'HOST-SENTINEL.txt');
  yield* files.writeFileString(hostSentinel, 'this machine\n');
  const store = yield* MachineStore;
  const { db } = store;
  const units = yield* MachineUnits;
  const records = yield* makeThreadRecords;
  const { store: threads, threads: threadFixture } = yield* threadStack({ db, units, records, kinds: ENTRY_KINDS });
  const made: string[] = [];
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (made.length === 0) return;
      yield* dockerSaid(['rm', '--force', '--volumes', ...made], 'remove the test guests');
      yield* dockerSaid(['volume', 'rm', '--force', ...made], 'remove the test volumes');
    }).pipe(Effect.orDie),
  );
  const installation = `qual-${crypto.randomUUID()}`;
  const backend = dockerGuests({ installation, closure: undefined });
  const preparedTrees = preparedTreesService({
    store: yield* preparedTreeStore(),
    preparation: dockerPreparation({ installation, closure: undefined }),
    checkoutOf: () => Effect.succeed(checkout),
    storageRoot: join(exports, 'artifacts'),
  });
  const owners = yield* sandboxServices({
    store: yield* sandboxStore(),
    runtime: backend,
    checkoutOf: () => Effect.succeed(checkout),
    exportsRoot: exports,
  }).pipe(
    Effect.provideService(PreparedTrees, preparedTrees),
    Effect.provideService(SandboxHolds, sandboxHolds(yield* threadResourceStore())),
  );
  const sandboxes = Context.get(owners, Sandboxes);
  const worlds = yield* leasedWorlds({
    checkout: () => Effect.die('the fixture binds every thread to a sandbox'),
    hosts: [Context.get(owners, GuestWorlds).worldHost()],
    place: () => Effect.succeed(null),
  });
  yield* Effect.addFinalizer(() => worlds.closeAll().pipe(Effect.orDie));
  const created = yield* db
    .insert(project())
    .values({
      name: 'fixture',
      repoKey: checkout,
      rootPath: checkout,
      createdAt: new Date(yield* Clock.currentTimeMillis),
    })
    .returning({ id: project().id })
    .get();
  const projectId = created!.id;
  return { checkout, head, hostSentinel, projectId, worlds, sandboxes, backend, threads, threadFixture, made, store, units };
});
class Fixture extends Context.Service<Fixture, Effect.Success<typeof makeFixture>>()('testing/executions/SandboxWorldFixture') {}
const sandboxWorld = kind(Fixture, (_params: null) =>
  Effect.gen(function* () {
    const processes = yield* sharedPool;
    const context = yield* Layer.build(
      unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, processes))),
        Layer.provideMerge(platform),
      ),
    );
    return yield* Effect.provide(makeFixture, context);
  }),
);
const fixture = () =>
  world(sandboxWorld, null, { own: 'the subject is guest world isolation and stop/resume lifecycle' }).pipe(Layer.provideMerge(platform));
const boundThread = Effect.fnUntraced(function* () {
  const { sandboxes, head, projectId, made, threads, threadFixture, store, units } = yield* Fixture;
  const record = yield* sandboxes.prepare({
    ownerId: 'operator',
    source: { kind: 'project', projectId, commit: head },
    limits: { pids: 128, memory: '512m', cpus: '1' },
    exclude: [':(exclude).tagma'],
  });
  made.push(record.runtime.container);
  const parent = yield* threads.insert({ ownerId: 'operator', agentId: 'tagma' });
  yield* scopeRecord(store.db, parent.id, { projectId });
  const row = yield* units.write('sandboxWorld.row', (tx) =>
    Effect.gen(function* () {
      const child = yield* threads.insertChild(
        parent.id,
        { ownerId: 'operator', agentId: 'tagma', hostKind: 'sandbox', hostId: record.id },
        tx,
      );
      const born = yield* threadFixture.rows.inheritFacet({ threadId: child.id, fromThreadId: parent.id, agentId: 'tagma' }, tx);
      yield* sandboxes.admit({ host: { kind: 'sandbox', id: record.id }, child, projectId: born, carried: 'fresh' }, tx);
      return child;
    }),
  );
  yield* sandboxes.ready(row);
  return row;
});
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
type Request = {
  tools: string[];
  messages: readonly Message[];
  instructions: string | undefined;
};
function scriptedRunner(script: (turn: number) => LLMEvent[], seen: Request[]): ReturnType<typeof makeAgentRunner> {
  return makeAgentRunner({
    idleMs: 60000,
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
            seen.push({
              tools: Object.keys(input.tools).sort(),
              messages: input.messages,
              instructions: selection.instructions,
            });
            return Stream.fromIterable(script(seen.length));
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
const view = (row: ThreadRow): ThreadView => ({
  id: row.id,
  ownerId: row.ownerId,
  agentId: row.agentId,
  hostKind: row.hostKind,
  hostId: row.hostId,
  bindings: row.bindings,
  cacheGroup: row.id,
  capabilities: row.capabilities,
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
  authority: { mode: 'bypass', bypassFrom: row.id },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const outputs: AgentToolOutputs = {
  project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
  projectMessages: (messages) => Effect.succeed(messages),
};
const input = (thread: ThreadView, id: string, messages: readonly Message[], frozen?: string): ThreadRunInput & ThreadPrepareInput => ({
  thread,
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
    ownerId: 'operator',
    provider: 'openai-oauth',
    model: 'gpt-5.5',
    reasoning: null,
    switches: {},
  },
  messages,
  signals: { drain: () => Effect.succeed([]), hasPending: () => Effect.succeed(false) },
  supply: { sources: noSources, outputTools: {} },
  context: {
    project: ({ messages }) => Effect.succeed({ messages }),
    lower: (messages) => Effect.succeed(messages),
    observe: () => Effect.succeed(undefined),
  },
  toolOutputs: outputs,
  ...(frozen === undefined ? { commitInstructions: (text: string) => Effect.succeed(text) } : { instructions: frozen }),
});
const launch = <TWrite>(agent: ThreadAgent<TWrite>, given: ThreadRunInput & ThreadPrepareInput) =>
  Effect.flatMap(agent.prepare(given), (prepared) => prepared.start(given));
const SECTIONS = contributions([
  ...Object.values(threadSections()),
  {
    id: 'the-sandbox-tree',
    owner: 'sandbox',
    render: theSandboxTree,
    path: 'src/sandbox/doctrine/theSandboxTree.ts',
    place: { prompt: 60 },
  },
]);
const makeDoor = Effect.map(operationCatalog, (catalog) => ({
  catalog,
  door: nativeDoor(
    quiet(workerLanes()).pipe(
      Context.add(RuleChecks, NO_RULES),
      Context.add(OperationChecks, operationChecks(NO_RULES)),
      Context.add(WorkingOrigins, {
        of: () => Effect.succeed(null),
        rootOf: () => Effect.succeed(null),
        placeOf: () => Effect.succeed(null),
      }),
    ),
    null,
    catalog,
    callLifetimes({
      performance: {} as never,
      profiles: {} as never,
      memory: {} as never,
      heap: {} as never,
      checkoutActs: {} as never,
      owners: Context.make(CommitHooks, {} as CommitHooks['Service']).pipe(
        Context.add(CacheWarmth, {} as CacheWarmth['Service']),
        Context.add(ChangeRecord, {} as ChangeRecord['Service']),
        Context.add(SandboxFiles, {} as SandboxFiles['Service']),
      ) as never,
    }),
  ),
}));
const shown = (seen: Request[], afterTurn: number): string => JSON.stringify(seen[afterTurn]?.messages ?? []);
dockerSuite('sandbox worlds', () => {
  layer(fixture(), { excludeTestServices: true })('docker', (it) => {
    it.effect('a code run meets one tree at the commit named, without the graph, and reaches nothing of this machine', () =>
      Effect.gen(function* () {
        const seen: Request[] = [];
        const { worlds, checkout, projectId, hostSentinel, sandboxes, backend } = yield* Fixture;
        const { catalog, door } = yield* makeDoor;
        const row = yield* boundThread();
        const thread = view(row);
        const runner = yield* scriptedRunner((turn) => {
          switch (turn) {
            case 1:
              return call(turn, 'read', { path: 'src/answer.txt' });
            case 2:
              return call(turn, 'ls', { path: '.' });
            case 3:
              return call(turn, 'read', { path: hostSentinel });
            case 4:
              return call(turn, 'bash', {
                command: `cat ${hostSentinel} 2>&1; echo "exit=$?"`,
                description: 'reach the host sentinel',
              });
            case 5:
              return call(turn, 'bash', {
                command: 'uname -s; id -u; ls -a /work | tr "\\n" " "; test -d /work/.git && echo git || echo no-git',
                description: 'the guest facts',
              });
            default:
              return answer(turn, 'Looked around.');
          }
        }, seen);
        const registered = composeAgent(
          ruleRegistry,
          tree,
          yield* servedCapabilities(),
          runner,
          {} as ThreadParts['rows'],
          {} as ThreadParts['mandate'],
          teamLess,
          (view, use) =>
            Effect.map(
              worlds.of({
                thread: view,
                at: {
                  threadId: view.id,
                  runId: use.runId ?? view.id,
                  generation: WorkspaceGeneration.make(use.context?.generation ?? 0),
                },
                root: checkout,
                projectId,
              }),
              (acquired) =>
                asThreadContext({
                  thread: view,
                  world: acquired.world,
                  projectId,
                  projectRoot: checkout,
                  origin: null,
                  comments: () => commentPolicy().fallback,
                  vocabulary: () => tagIndex([], BEHAVIOUR_REGISTRY),
                  identity: sessionIdentity,
                  commandTimes: unruledTimes,
                  grants: testGrantSigner,
                  project: { id: projectId, name: 'tree' },
                  caller: { actor: { kind: 'operator' } },
                  workingRoot: checkout,
                  graph: Effect.succeed(Context.make(Git, {} as Git['Service'])),
                  machine: {} as never,
                  mcpServers: {} as never,
                  servingGit: {} as never,
                  rows: {} as never,
                  graphRefused: {} as never,
                  execution: door,
                  offers: nativeOffers(catalog),
                }),
            ),
          SECTIONS,
        );
        const run = yield* launch(registered, input(thread, 'look', [Message.user('Look around.')]));
        yield* run.output.response;
        expect(seen.length).toBe(6);
        expect(seen[0]?.tools).toEqual(['bash', 'delete', 'edit', 'glob', 'grep', 'ls', 'read', 'rename', 'tool_search', 'write']);
        expect(shown(seen, 1)).toContain('the committed tree');
        const listing = shown(seen, 2);
        expect(listing).toContain('src');
        expect(listing).not.toContain('.tagma');
        expect(listing).not.toContain('uncommitted');
        expect(shown(seen, 3)).not.toContain('this machine');
        const viaShell = shown(seen, 4);
        expect(viaShell).not.toContain('this machine');
        expect(viaShell).toMatch(/No such file|not found|cannot|exit=[1-9]/);
        const facts = shown(seen, 5);
        expect(facts).toContain('Linux');
        expect(facts).toContain('65534');
        expect(facts).toContain('no-git');
      }),
    );
    it.effect('a stop takes the guest, and a resumed run finds the sentinel where the first run left it', () =>
      Effect.gen(function* () {
        const seen: Request[] = [];
        const { worlds, checkout, projectId, hostSentinel, sandboxes, backend } = yield* Fixture;
        const { catalog, door } = yield* makeDoor;
        const row = yield* boundThread();
        const thread = view(row);
        const sentinel = `left here ${Math.random().toString(36).slice(2)}`;
        const runner = yield* scriptedRunner((turn) => {
          switch (turn) {
            case 1:
              return call(turn, 'write', {
                path: 'src/sentinel.txt',
                content: `${sentinel}\n`,
              });
            case 2:
              return answer(turn, 'Written.');
            case 3:
              return call(turn, 'read', { path: 'src/sentinel.txt' });
            default:
              return answer(turn, 'Read.');
          }
        }, seen);
        const registered = composeAgent(
          ruleRegistry,
          tree,
          yield* servedCapabilities(),
          runner,
          {} as ThreadParts['rows'],
          {} as ThreadParts['mandate'],
          teamLess,
          (view, use) =>
            Effect.map(
              worlds.of({
                thread: view,
                at: {
                  threadId: view.id,
                  runId: use.runId ?? view.id,
                  generation: WorkspaceGeneration.make(use.context?.generation ?? 0),
                },
                root: checkout,
                projectId,
              }),
              (acquired) =>
                asThreadContext({
                  thread: view,
                  world: acquired.world,
                  projectId,
                  projectRoot: checkout,
                  origin: null,
                  comments: () => commentPolicy().fallback,
                  vocabulary: () => tagIndex([], BEHAVIOUR_REGISTRY),
                  identity: sessionIdentity,
                  commandTimes: unruledTimes,
                  grants: testGrantSigner,
                  project: { id: projectId, name: 'tree' },
                  caller: { actor: { kind: 'operator' } },
                  workingRoot: checkout,
                  graph: Effect.succeed(Context.make(Git, {} as Git['Service'])),
                  machine: {} as never,
                  mcpServers: {} as never,
                  servingGit: {} as never,
                  rows: {} as never,
                  graphRefused: {} as never,
                  execution: door,
                  offers: nativeOffers(catalog),
                }),
            ),
          SECTIONS,
        );
        const first = yield* launch(registered, input(thread, 'write', [Message.user('Leave a sentinel.')]));
        yield* first.output.response;
        expect(seen.length).toBe(2);
        const frozen = seen[0]?.instructions;
        const record = yield* sandboxes.ofThread(row.id);
        expect(record).not.toBeNull();
        yield* backend.stop(record!.runtime);
        yield* sandboxes.ready(row);
        const second = yield* launch(
          registered,
          input(thread, 'read', [Message.user('Leave a sentinel.'), Message.user('Read it back.')], frozen),
        );
        yield* second.output.response;
        expect(seen.length).toBe(4);
        expect(shown(seen, 3)).toContain(sentinel);
      }),
    );
  });
});
