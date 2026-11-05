import { lookupModels } from '@runlith/agent/thread/compaction/lookupModels';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { fixtureGraph } from '../fixtureGraph.js';
import { fixtureMigrations } from '../migrations.js';
import { sessionIdentityLayer, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { SessionIdentity } from '../../../platform/contract/wire/session.js';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { SERVER_SRC } from '../repoRoot.js';
import { entryCommand } from '../../../installation/contract/wire/junction.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { THREAD_AUTHORITY_DEFAULT, type ThreadContextReading } from '@runlith/agent/thread/rows';
import { sql } from 'drizzle-orm';
import type { ThreadEntry } from '@runlith/agent/transcript/entries';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { HostRequestKey, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { Git } from '@runlith/git/Git';
import { Cause, Clock, Context, Deferred, Effect, FileSystem, Layer, Queue, Ref, Schema, Scope, Stream } from 'effect';
import type { ExecutionRecords } from '../../../executions/contract/service/records.js';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { shippedChain } from '../../../platform/store/chain.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { kernelWrites } from '../../../native-harness/testing/doubles.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { shared } from '@runlith/testbed/worlds';
import { hostBundleWorld } from '../executions/fixture.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { fixtureHome } from '../../../platform/testing/roots.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { acpTestSeat as acpSeat } from '../../../external-harnesses/testing/seats.js';
import { shippedAdapters } from '../external-harnesses/shipped.js';
import { HarnessAdapters } from '../../../external-harnesses/contract/service/adapters.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { ThreadRecords } from '../../../thread-record/contract/service/records.js';
import { SessionRead } from '../../../threads/contract/service/harness.js';
import { ThreadLookup } from '../../../threads/contract/service/reads.js';
import { ThreadMandate } from '../../../threads/contract/service/mandate.js';
import type { NativeThreadState } from '../../../threads/contract/service/state.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import { projectsLayer } from '../../../projects/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { hostWorkspace } from '../hostWorkspace.js';
import type { WorkspaceServices } from '../../../workspace/layer.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { WorktreeRecords } from '../../../worktrees/contract/service/worktrees.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import {
  makeMachineWorld,
  executionPolicy,
  terminalEndings,
  watchedQueue,
  terminalHostCustody,
  endHosts,
  executionHost,
} from '../../../executions/testing/doubles.js';
import {
  unmeasuredObservation,
  modelChanges,
  threadInboxStore,
  sqliteThreadJournal,
  baseReach,
  threadAttachmentStore,
  approvalPreferences,
  engineStates,
  LEASE_RHYTHM,
  REAPER_RHYTHM,
  SETTLEMENT_RHYTHM,
} from '../../../threads/testing/doubles.js';
import { makeThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import type { GuidanceSources } from '@runlith/agent/thread/transport/contract';
import { Agent } from '@runlith/agent/Agent';
import { makeAgentRunner } from '@runlith/agent/AgentRunner';
import { threadAgent } from '@runlith/agent/thread/agents/ThreadAgent';
import { ApprovalModes, approvalModesLayer } from '@runlith/agent/modes/ApprovalModes';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { threadAgentsLayer, threadCompactorLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { makeThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import { makeThreadDigestStrategy } from '@runlith/agent/thread/compaction/digestStrategy';
import { makeThreadSummaryStrategy } from '@runlith/agent/thread/compaction/summaryStrategy';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import { registeredAgents } from '@runlith/agent/thread/conformance/agents';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { ThreadRuns } from '@runlith/agent/collaboration/runs';
import type { ThreadInboxItemValues } from '@runlith/agent/thread/storage/inbox';
import type { AdapterReports } from '@runlith/agent/thread/run/lifecycle/RunReports';
import type { ThreadWriteTx } from '@runlith/agent/thread/ThreadPorts';
import { prepareHostFixture, startHostFixture } from '../../../executions/testing/hostFixture.js';
import { HostManagement } from '../../../executions/contract/service/host.js';
import { HarnessPermissions } from '../../../external-harnesses/contract/service/permissions.js';
import { threadCallFailed } from '../../../threads/contract/service/failure.js';
import { threadParts } from '../threadParts.js';
import {
  threadStore,
  threadRunStores,
  nativeTransitions,
  nativeThreadRows,
  threadCompactionStore,
  threadToolOutputStore,
  COMPACTION_POLICY,
  COMPACTION_PROMPT,
  COMPACTION_TEXT,
} from '../../../native-harness/testing/doubles.js';
import { guardedFloor } from '../../../executions/testing/guardedFloor.js';
import {
  HarnessLanes,
  HarnessSessionStore,
  ProtocolDriver,
  acpTransport,
  ProtocolJournal,
  ProtocolRows,
  VendorTurns,
  protocolSessions,
  sessionRead,
} from '../../../external-harnesses/testing/doubles.js';
import { sessionStoreOver } from '../../../external-harnesses/testing/floor.js';
import { backpressured, delayedLaunches, disrupted, observedLaunches, type Floor } from './protocolWriting.js';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { ENTRY_KINDS } from '../composed.js';
import { builtinRegistry } from '../providerCatalog.js';
import { ProviderRegistry } from '../../../providers/contract/service/registry.js';
import { HarnessAccounts } from '../../../providers/contract/service/harness.js';
const SessionStartRead = Context.Reference<boolean>('testing/SessionStartRead', { defaultValue: () => false });
const ENDING_KINDS: ReadonlySet<string> = new Set(['failure', 'run-end']);
const machineWorld = makeMachineWorld(() => null);
const AGENT = join(SERVER_SRC, 'external-harnesses', 'testing', 'acpAgent.ts');
export const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
type World = {
  readonly checkout: string;
  readonly canonical: string;
  readonly context: Context.Context<MachineStore | MachineUnits | WorkspaceServices | GraphServices | WorktreeRecords>;
  readonly projectId: number;
  readonly settings: Context.Service.Shape<typeof Settings>;
};
type Served = {
  readonly harness: AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;
  readonly journal: InstanceType<typeof ProtocolJournal>;
  readonly ownership: RunOwnership;
  readonly runs: () => Context.Service.Shape<typeof ThreadRuns>;
};
export type Said = {
  readonly threadId: string;
  readonly run: string;
  readonly text: string;
};
const heardSchema = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.optional(Schema.String),
    id: Schema.optional(Schema.Unknown),
    result: Schema.optional(Schema.Unknown),
    params: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.Unknown),
  }),
);
export type Heard = typeof heardSchema.Type;
export type Harness = {
  readonly name: 'devin' | 'claude-code' | 'opencode';
  readonly hosts: string | null;
};
export const heard = Effect.fn('testing.protocolHeard')(function* (report: string) {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files.readFileString(report).pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed('')));
  return yield* Effect.forEach(text.split('\n').filter(Boolean), (line) => Schema.decodeUnknownEffect(heardSchema)(line));
}, Effect.provide(BunFileSystem.layer));
export const signal = Effect.fn('testing.protocolSignal')(function* (path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  const staged = `${path}.staged`;
  yield* files.writeFileString(staged, text);
  yield* files.rename(staged, path);
}, Effect.provide(BunFileSystem.layer));
export const scenario = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.scoped(body).pipe(Effect.provide(HostRegistration.layer), Effect.provide(endpointConnection), Effect.provide(platform));

export type ProtocolChanges = Effect.Effect<Effect.Effect<unknown>, never, Scope.Scope>;

export const until = Effect.fn('testing.protocolUntil')(function* <A, E, R>(
  read: Effect.Effect<A | null, E, R>,
  what: string,
  report?: string,
  changes?: ProtocolChanges,
) {
  yield* Effect.annotateCurrentSpan({ what, report });
  const next = changes === undefined ? Effect.sleep(20) : yield* changes;
  for (;;) {
    const seen = yield* read;
    if (seen !== null) return seen;
    yield* next;
  }
}, Effect.scoped);

export const words = Effect.fnUntraced(function* (threadId: string, text: string) {
  return {
    id: `harness-input:${crypto.randomUUID()}`,
    threadId,
    sender: { kind: 'reader' as const },
    kind: 'turn' as const,
    body: { text, attachments: [] },
    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  };
});
export const protocolRig = Effect.fn('testing.protocolRig')(function* (fixture: string, readers?: number) {
  const files = yield* FileSystem.FileSystem;
  const providers = yield* ProviderRegistry;
  const accounts = yield* HarnessAccounts;
  const installation = InstallationId.make(fixture);
  const owned = yield* files.realPath(yield* files.makeTempDirectoryScoped({ directory: fixtureHome(), prefix: `${fixture}-` }));
  const stage = join(owned, 'stage');
  const bundleRoot = (yield* shared(hostBundleWorld, null)).root;
  const processes = yield* sharedPool;
  const home = join(owned, 'world');
  const checkout = join(home, 'checkout');
  const stateDir = join(home, 'host');
  yield* files.makeDirectory(join(stage, 'bin'), { recursive: true });
  yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
  yield* files.makeDirectory(stateDir, { recursive: true, mode: 0o700 });
  const canonical = yield* files.realPath(stateDir);
  const agentBinary = Effect.fn('testing.protocolBinary')(function* (report: string, mode = 'plain', name: Harness['name'] = 'devin') {
    const path = join(stage, 'bin', name === 'devin' ? 'devin' : WORLD_COMMAND);
    yield* files.writeFileString(
      path,
      ['#!/bin/sh', `exec ${process.execPath} ${AGENT} --report ${report} --mode ${mode}${name === 'devin' ? ' "$@"' : ''}`].join('\n'),
      { mode: 0o755 },
    );
  });
  yield* agentBinary(join(stage, 'boot.report'));
  const harnesses = new Set<AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>>();
  const changes = Effect.fnUntraced(function* (threadId?: string): Effect.fn.Return<Effect.Effect<unknown>, never, Scope.Scope> {
    const moved = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
    const wake = () => {
      Queue.offerUnsafe(moved, undefined);
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const watcher = watch(stage, { recursive: true }, wake);
        const subscriptions = [...harnesses].map((harness) =>
          threadId === undefined ? harness.reads.subscribeStates(wake) : harness.reads.subscribe(threadId, wake),
        );
        return () => {
          watcher.close();
          for (const unsubscribe of subscriptions) unsubscribe();
        };
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    return Queue.take(moved);
  });
  const stoodPath = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${join(stage, 'bin')}:${stoodPath ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (stoodPath === undefined) delete process.env.PATH;
        else process.env.PATH = stoodPath;
      }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const survivors = yield* endHosts(owned);
      if (survivors.length > 0) return yield* Effect.die(new Error(`the protocol rig left hosts ${survivors.join(', ')}`));
    }).pipe(Effect.orDie),
  );
  const hostCommand = yield* prepareHostFixture(canonical, fixture, bundleRoot);
  yield* startHostFixture({ command: hostCommand, state: canonical });
  const rigScope = yield* Effect.scope;
  let hostFailure: Cause.Cause<Effect.Error<ReturnType<typeof endHosts>> | Effect.Error<ReturnType<typeof startHostFixture>>> | null = null;
  const replaceHost = Effect.fn('testing.protocolReplaceHost')(
    function* () {
      yield* endHosts(owned);
      yield* startHostFixture({ command: hostCommand, state: canonical }).pipe(Scope.provide(rigScope));
      hostFailure = null;
    },
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        hostFailure = cause;
      }),
    ),
  );
  const context = yield* Layer.build(
    hostWorkspace(machineWorld).pipe(
      Layer.provideMerge(worktreeRecordsLayer),
      Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
      Layer.provideMerge(fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer()))),
      Layer.provideMerge(Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, { durable: false, readers }, processes))),
      Layer.provideMerge(sessionIdentityLayer),
    ),
  );
  yield* runGit(Context.get(context, Git), 'fixture', ['-C', checkout, 'init', '-q', '-b', 'main', '.']);
  const store = Context.get(context, MachineStore);
  const [project] = yield* store.db
    .insert(projectRow())
    .values({
      name: fixture,
      repoKey: fixture,
      rootPath: checkout,
      createdAt: new Date(yield* Clock.currentTimeMillis),
    })
    .returning({ id: projectRow().id });
  if (project === undefined) return yield* Effect.die(new Error('the protocol project was not created'));
  const projectId = project.id;
  yield* Context.get(context, Coverage).cover(projectId);
  const world: World = { checkout, canonical, context, projectId, settings: Context.get(context, Settings) };
  const openThread = Effect.fn('testing.protocolThread')(function* (id: string, harness: Harness = { name: 'devin', hosts: null }) {
    yield* files.makeDirectory(join(stage, 'scratch', id), { recursive: true });
    const store = Context.get(world.context, MachineStore);
    const units = Context.get(world.context, MachineUnits);
    const now = new Date(yield* Clock.currentTimeMillis);
    yield* bornThread(store.db, {
      id,
      ownerId: 'operator',
      agentId: 'harness',
      spawnRootId: id,
      cacheGroup: id,
      authority: THREAD_AUTHORITY_DEFAULT,
      createdAt: now,
      updatedAt: now,
    });
    const records = yield* Effect.provide(makeThreadRecords, world.context);
    const rows = yield* Effect.provide(
      Effect.flatMap(threadStore(records, ENTRY_KINDS), (threads) => nativeThreadRows(threads, records)),
      world.context,
    );
    yield* units.write(kernelWrites(), (unit) =>
      rows.attachFacet(
        {
          threadId: id,
          projectId: world.projectId,
          harness: acpSeat(harness.name, harness.hosts, undefined),
        },
        unit,
      ),
    );
  });
  const floor = Effect.fn('testing.protocolFloor')(function* (reported: Said[], options: Floor = { fails: 0, refuses: false }) {
    if (hostFailure !== null) return yield* Effect.failCause(hostFailure);
    const address = yield* hostAddress(world.canonical, fixture);
    const connectionScope = yield* Scope.fork(yield* Effect.scope);
    const connection = yield* executionHost(address).pipe(Scope.provide(connectionScope));
    const port = options.hostStop === undefined ? connection.port : { ...connection.port, stop: options.hostStop(connection.port.stop) };
    const registration = yield* HostRegistration;
    const context = world.context;
    const units = Context.get(context, MachineUnits);
    const store = Context.get(context, MachineStore);
    const custody = yield* terminalHostCustody({
      executions: port,
      welcome: connection.welcome,
      installation,
      state: world.canonical,
      offered: {
        bundle: bundleRoot,
        digest: (yield* registration.read(world.canonical)).artifact!.identity.digest,
        database: store.schema,
        application: shippedChain(fixtureMigrations),
        policy: executionPolicy(),
        lifetime: 'with-parent',
      },
    });
    yield* Ref.set(connection.opened, custody.opened);
    yield* custody.ensure();
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const { custody } = yield* port.status();
        const answer = yield* port.release({ installation, operation: HostRequestKey.make(`release-${crypto.randomUUID()}`) }, custody);
        if (answer._tag !== 'Held' || answer.custody.holder !== undefined)
          return yield* Effect.die(new Error(`the protocol floor did not release host custody: ${JSON.stringify(answer)}`));
      }).pipe(Effect.orDie),
    );
    const watched = yield* watchedQueue();
    const {
      terminals,
      grants,
      stores: terminalStore,
    } = yield* guardedFloor({ port, guarded: custody.guarded(), db: store.db, installation, watched }).pipe(
      Effect.provide(Context.add(context, SessionIdentity, sessionIdentity)),
    );
    const watching = yield* Scope.fork(yield* Effect.scope);
    const endings = yield* terminalEndings({
      terminals,
      discharge: terminals,
      terminalRows: terminalStore.terminalRows,
      commandRows: terminalStore.commandRows,
      opened: watched,
      ended: yield* Queue.unbounded<ExecutionRef>(),
    }).pipe(Effect.provideService(MachineUnits, units), Scope.provide(watching));
    yield* Effect.forkIn(endings.attend(), watching);
    const records = yield* Effect.provideContext(makeThreadRecords, context);
    const threads = yield* Effect.provideContext(
      Effect.flatMap(threadStore(records, ENTRY_KINDS), (parts) => threadParts({ db: store.db, units, threads: parts, records })),
      context,
    );
    const host = HostManagement.of({
      standing: Effect.succeed({
        boot: { _tag: 'Raised' },
        custodian: true,
        detail: 'the fixture raised its host',
        geometry: { rows: 40, columns: 120 },
        notice: null,
      }),
      connection,
      successor: Effect.succeed(false),
    });
    let opening = options.opening;
    const sessionStore = yield* sessionStoreOver(
      store.db,
      units,
      threads.spells,
      records,
      yield* Effect.provideContext(modelChanges(), context),
      (_threadId, facet) => {
        if (
          facet.session?.state !== 'starting' ||
          opening === undefined ||
          (opening.armed !== undefined && !Deferred.isDoneUnsafe(opening.armed))
        )
          return Effect.void;
        const paused = opening;
        opening = undefined;
        return Effect.andThen(
          Deferred.succeed(paused.entered, undefined),
          Effect.andThen(
            Deferred.await(paused.released),
            paused.failure === undefined ? Effect.void : Effect.fail(threadCallFailed(new Error(paused.failure))),
          ),
        );
      },
    );
    let startRead = options.startRead;
    const protocolStore = new Proxy(sessionStore, {
      get(target, key) {
        if (key === 'read')
          return (threadId: string) =>
            Effect.flatMap(target.read(threadId), (facet) =>
              Effect.flatMap(SessionStartRead, (marked) => {
                const paused = startRead;
                if (!marked || paused === undefined) return Effect.succeed(facet);
                startRead = undefined;
                return Effect.andThen(Deferred.succeed(paused.entered, undefined), Effect.as(Deferred.await(paused.released), facet));
              }),
            );
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const inbox = yield* Effect.provideContext(threadInboxStore(ENTRY_KINDS), context);
    let preparing = options.preparing;
    const protocolInbox = {
      ...inbox,
      delivered: (...input: Parameters<typeof inbox.delivered>) =>
        Effect.suspend(() => {
          const paused = preparing;
          if (paused === undefined) return inbox.delivered(...input);
          preparing = undefined;
          return Effect.andThen(
            Deferred.succeed(paused.entered, undefined),
            Effect.andThen(Deferred.await(paused.released), inbox.delivered(...input)),
          );
        }),
    };
    const bases = yield* Effect.provideContext(baseReach, context);
    const pictures = yield* threadAttachmentStore(join(world.checkout, '.pictures'), bases.sources);
    const kernel = yield* Effect.provideContext(threadStore(records, ENTRY_KINDS), context);
    const log = yield* Effect.provideContext(sqliteThreadJournal(), context);
    const rows = new ProtocolRows(store.db, units);
    const turns = new VendorTurns(store.db, units);
    let failing = options.fails;
    const usages: {
      readonly turn: string;
      readonly usage: unknown;
    }[] = [];
    const entries = (threadId: string) =>
      Effect.map(log.eventsAfter(threadId, 0, 100), (rows) =>
        rows.flatMap((row) => {
          const entry = (
            row.payload as {
              readonly entry?: ThreadEntry;
            }
          ).entry;
          return entry === undefined || ENDING_KINDS.has(row.kind) ? [] : [entry];
        }),
      );
    const endEntries = (threadId: string) =>
      Effect.map(log.eventsAfter(threadId, 0, 100), (rows) =>
        rows.flatMap((row) => {
          const entry = (
            row.payload as {
              readonly entry?: ThreadEntry;
            }
          ).entry;
          return entry === undefined || !ENDING_KINDS.has(row.kind) ? [] : [entry];
        }),
      );
    const harnessAgent = threadAgent({
      agent: new Agent({
        id: 'harness',
        name: 'Harness',
        description: 'A thread run by an external agent.',
        instructions: () => '',
        tools: () => ({}),
        stopWhen: [],
      }),
      runner: yield* makeAgentRunner({
        models: {
          request: () => {
            throw new Error('The protocol road never calls a model.');
          },
        },
        idleMs: 30000,
      }),
      runPolicy: { userStartable: true, backgroundStartable: false },
      context: () => Effect.succeed({}),
    });
    let dropping = options.dropsLaunch === true;
    let latest: Served | null = null;
    const served = (): Served => {
      if (latest === null) throw new Error('the protocol rig has served no driver');
      return latest;
    };
    const compactionModels = lookupModels({
      request: () => {
        throw new Error('The protocol road summarizes nothing in the core.');
      },
      capacity: () => ({ context: 100000, output: 4000 }),
      cacheLifetime: () => ({ promisedSeconds: null, prior: null }),
      compactionTrigger: () => undefined,
    });
    const coreRecords = yield* Effect.provideContext(makeThreadRecords, context);
    const runsOf = yield* Effect.provideContext(threadRunStores(coreRecords, ENTRY_KINDS), context);
    const sessionReading = yield* Effect.provideContext(sessionRead, context);
    const modes = Context.get(yield* Layer.build(approvalModesLayer), ApprovalModes);
    const states = yield* Effect.provideContext(
      engineStates,
      context.pipe(
        Context.add(ThreadRecords, coreRecords),
        Context.add(SessionRead, sessionReading),
        Context.add(ThreadLookup, threads.list),
        Context.add(ThreadMandate, threads.mandate),
        Context.add(ApprovalModes, modes),
      ),
    );
    const serve = Effect.gen(function* () {
      let nativeRuns: Context.Service.Shape<typeof ThreadRuns> | null = null;
      const harness = yield* Effect.acquireRelease(
        AgentHarness.make<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>(
          Layer.mergeAll(
            Layer.succeed(ApprovalModes, modes),
            Layer.succeed(ThreadEntryKinds, ENTRY_KINDS),
            threadStorageLayer<Unit<'machine'>, WriteUnit<'machine'>>({
              storage: kernel,
              eventLog: log,
              transitions: yield* Effect.provideContext(nativeTransitions(kernel), context),
              createRuns: (ownerId) => {
                const runs = runsOf({ ownerId, scope: sql`1 = 1` });
                return options.runs?.(runs) ?? runs;
              },
              attachments: pictures,
              inbox,
              toolOutputs: threadToolOutputStore(join(world.checkout, '.results')),
              ownerSettings: yield* Effect.provideContext(approvalPreferences(), context),
            }),
            threadCompactorLayer(
              makeThreadCompaction({
                models: compactionModels,
                checkpoints: yield* Effect.provideContext(threadCompactionStore(), context),
                policy: () => Effect.succeed(COMPACTION_POLICY(0.2)),
                strategy: makeThreadSummaryStrategy({ models: compactionModels, prompt: COMPACTION_PROMPT() }),
                recovery: makeThreadDigestStrategy(),
                text: COMPACTION_TEXT(),
                transcriptLocation: () => Effect.succeed(join(world.checkout, 'transcript.jsonl')),
              }),
            ),
            threadHostLayer({
              resting: { resting: (threadId: string) => Effect.sync(() => options.resting?.has(threadId) === true) },
              rhythms: { lease: LEASE_RHYTHM(), reaper: REAPER_RHYTHM(), settlement: SETTLEMENT_RHYTHM(), streamFlushIntervalMs: 0 },
            }),
            threadAgentsLayer(yield* registeredAgents([harnessAgent], 'protocol-rig').pipe(Effect.orDie)),
          ),
          yield* makeThreadLiveFeed<NativeThreadState>(),
          {
            toState: states.of,
            subscribers: options.settled === undefined ? undefined : [options.settled],
            fillers: {
              runs: (given) => {
                nativeRuns = given;
                return given;
              },
            },
          },
        ),
        (opened) => opened.dispose(),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => harnesses.add(harness)),
        () =>
          Effect.sync(() => {
            harnesses.delete(harness);
          }),
      );
      const reaching = harness.runs.reports().of('acp', {
        display: (threadId, name, reading) => harness.runs.hosting().display(threadId, name, reading),
      });
      const reports: AdapterReports = {
        ...reaching,
        ended: (run, ending, spent) => {
          const plan = reaching.ended(run, ending, spent);
          return {
            tables: plan.tables,
            run: Effect.fn('testing.protocolEnd')(function* (tx: ThreadWriteTx) {
              if (failing > 0) {
                failing -= 1;
                return yield* new ThreadStorageFailed({ call: 'fixture.end', cause: new Error('the run ledger could not be reached') });
              }
              const done = yield* plan.run(tx);
              if (done.status === 'applied') {
                yield* tx.afterCommit(
                  Effect.gen(function* () {
                    if (spent?.rest !== undefined) usages.push({ turn: run.id, usage: spent.rest });
                    const said = (yield* entries(run.threadId))
                      .filter((entry) => entry.type === 'message' && entry.role === 'assistant' && entry.runId === run.id)
                      .at(-1);
                    reported.push({
                      threadId: run.threadId,
                      run: run.id,
                      text: ending.kind === 'failed' ? ending.reason : said?.type === 'message' ? said.text : '',
                    });
                  }).pipe(Effect.orDie),
                );
              }
              return done;
            }),
          };
        },
      };
      const ownership = yield* harness.runs.ownership();
      const journal = new ProtocolJournal(
        reports,
        kernel,
        (threadId) => harness.threads.publish(threadId),
        harness.threads,
        inbox,
        pictures,
        held,
        providers,
        kernelWrites(),
      );
      return {
        harness,
        journal,
        ownership,
        runs: () => {
          if (nativeRuns === null) throw new Error('the protocol rig has no runs');
          return nativeRuns;
        },
      } satisfies Served;
    });
    const held = yield* makeThreadAsides;
    let tails = 0;
    const stalled = (stalls: NonNullable<Floor['stalls']>) =>
      Effect.andThen(Deferred.succeed(stalls.entered, undefined), Deferred.await(stalls.released));
    const sources: GuidanceSources = {
      orientation: () => Effect.succeed({ texts: ['ORIENTATION'], law: null }),
      law: (_thread, delivered) => Effect.succeed({ text: delivered === null ? '' : 'LAW MOVED', law: 'law' }),
      recap: () => Effect.succeed(null),
      tail: (_threadId, { inputs }) =>
        Effect.andThen(
          options.stalls === undefined || ((tails += 1) === 1 && options.stalls.first !== true) ? Effect.void : stalled(options.stalls),
          Effect.succeed(options.notes === undefined ? null : { text: options.notes, ruleId: 'operator-notes', state: { inputs } }),
        ),
    };
    const unusedPermission = () => Effect.die('the protocol fixture judges through verdict');
    const permissions = HarnessPermissions.of({
      verdict: (_threadId, call) =>
        Effect.succeed(
          call.tool === 'bash' || call.tool === 'webfetch'
            ? { _tag: 'Asks' as const, ruleId: 'ask-pushing', reason: 'pushing asks the operator', asked: ['ask-pushing'] }
            : { _tag: 'Unspoken' as const },
        ),
      prompt: (_name, call) => `Devin asks to run \`${call.subject}\``,
      judge: unusedPermission,
      outcome: unusedPermission,
      ended: unusedPermission,
    });
    const writing =
      options.pressure !== undefined
        ? yield* backpressured(options.pressure, options).pipe(Effect.provideService(TerminalWriting, terminals))
        : options.refuses ||
            options.refusing !== undefined ||
            options.loses ||
            options.losesSteers ||
            options.steering !== undefined ||
            options.delays ||
            options.acknowledge !== undefined ||
            options.answers !== undefined
          ? yield* disrupted(options).pipe(Effect.provideService(TerminalWriting, terminals))
          : terminals;
    const visible =
      options.terminals?.(terminals) ??
      (options.missing
        ? new Proxy(terminals, { get: (target, key) => (key === 'record' ? () => Effect.succeed(null) : Reflect.get(target, key, target)) })
        : terminals);
    const output: ExecutionRecords['Service'] = options.records?.(terminals) ?? terminals;
    const runStore = (ownerId: string) => runsOf({ ownerId, scope: sql`1 = 1` });
    const touched = new Set<string>();
    let stopper: ((threadId: string) => Effect.Effect<unknown, unknown>) | null = null;
    const scenarioScope = yield* Effect.scope;
    const adapters = options.adapters ?? (yield* shippedAdapters);
    const driver = Effect.fn('testing.protocolDriver')(function* (
      owner: string,
      timing: {
        readonly clock?: Clock.Clock;
        readonly idleMs?: number;
        readonly graceMs?: number;
        readonly build?: string;
      } = {},
    ) {
      const { harness, journal, ownership, runs } = yield* serve;
      latest = { harness, journal, ownership, runs };
      const made = yield* ProtocolDriver.make(
        protocolStore,
        rows,
        turns,
        journal,
        ownership,
        kernel,
        runStore,
        held,
        protocolInbox,
        output,
        visible,
        terminals,
        writing,
        endings,
        host,
        world.settings,
        testGrantSigner,
        accounts,
        providers,
        {
          table: () => Effect.succeed([]),
          observe: () => Effect.void,
          merge: () => Effect.void,
          fail: () => Effect.void,
          refresh: () => Effect.void,
          changes: Stream.empty,
        },
        new HarnessLanes(grants, writing),
        permissions,
        { instructions: '', threshold: () => Effect.succeed(options.threshold ?? Infinity) },
        {
          upload: () => Effect.die(new Error('the road uploads no pictures')),
          keep: () => Effect.die(new Error('the road keeps no pictures')),
          drop: () => Effect.die(new Error('the road keeps no dropped files')),
          read: (threadId, _projectId, id) => pictures.read(threadId, id),
          locate: (threadId, _projectId, id) => pictures.located(threadId, id),
        },
        (threadId) =>
          Effect.map(kernel.metadata(threadId), (row) => ({
            projectId: world.projectId,
            root: options.place?.current ?? world.checkout,
            scratch: join(stage, 'scratch', threadId),
            selection: row === undefined ? undefined : { provider: row.provider, account: row.account },
          })),
        () => Effect.void,
        harness.runs.guidance(),
        sources,
        harness.runs.history(),
        () => Effect.void,
        () => Effect.void,
        (threadId) => harness.threads.handle(threadId, 'operator').compact({ at: 'end', mode: 'automatic' }),
        (threadId, name, reading) => harness.runs.hosting().display(threadId, name, reading),
        harness.reads.requests(),
        owner,
        timing.build ?? fixture,
        entryCommand(process.env),
        () => Effect.void,
        (threadId) => Effect.mapError(harness.runs.questions().reroute(threadId), threadCallFailed),
        { idleMs: timing.idleMs, graceMs: timing.graceMs },
      ).pipe(Effect.provideService(HarnessAdapters, adapters), (make) =>
        timing.clock === undefined ? make : Effect.provideService(make, Clock.Clock, timing.clock),
      );
      const lost = dropping;
      dropping = false;
      const runsForTransport = lost
        ? { ...made.runs, launch: () => Effect.void }
        : options.launching === undefined
          ? made.runs
          : delayedLaunches(made.runs, options.launching);
      const observed = options.opening ?? options.preparing;
      yield* Effect.orDie(
        harness.runs
          .transports()
          .register(
            acpTransport(
              made.asks,
              observed === undefined ? runsForTransport : observedLaunches(runsForTransport, observed),
              made.resource,
              made.history.transport,
              lost ? { compact: () => Effect.void } : made.compaction,
            ),
          ),
      );
      const handle = (threadId: string) => harness.threads.handle(threadId, 'operator');
      stopper = (threadId) => made.resource.release(threadId);
      yield* Scope.addFinalizer(
        scenarioScope,
        Effect.suspend(() =>
          Effect.forEach([...touched], (threadId) =>
            (stopper === null ? Effect.void : stopper(threadId)).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning('the rig could not stop a thread at teardown', { threadId, cause: Cause.pretty(cause) }),
              ),
            ),
          ),
        ),
      );
      const sessions = yield* protocolSessions({ driver: made, harness });
      const said = {
        sessions: {
          ...sessions,
          start: (threadId: string, prompt?: string, inputId?: string) =>
            Effect.provideService(sessions.start(threadId, prompt, inputId), SessionStartRead, true),
        },
        stop: (threadId: string) => made.resource.release(threadId),
        restart: (threadId: string) => (touched.add(threadId), handle(threadId).restart()),
        cancel: (threadId: string) =>
          Effect.flatMap(handle(threadId).stop(), (stopped) =>
            stopped.status === 'stopped'
              ? Effect.succeed({ runId: stopped.runId })
              : Effect.die(new Error(`the stop answered ${stopped.status}`)),
          ),
        send: (threadId: string, text: string) => (touched.add(threadId), handle(threadId).send(text)),
        start: (threadId: string, prompt?: string) => {
          touched.add(threadId);
          return prompt === undefined || prompt === '' ? made.ensure(threadId) : Effect.asVoid(handle(threadId).send(prompt));
        },
        receive: Effect.fn('testing.protocolReceive')(function* (threadId: string, item: ThreadInboxItemValues) {
          touched.add(threadId);
          const standing = yield* inbox.receipt(item.id);
          if (standing?.kind === 'compaction') {
            yield* made.ensure(threadId);
            const current = yield* made.current(threadId);
            const run = current === null ? null : yield* runStore(owner).runById(current);
            if (run !== null) yield* made.runs.queued(run);
            return { status: 'queued' as const, runId: null, acted: true };
          }
          if (standing === undefined) return yield* Effect.die(new Error('the protocol rig holds no such item'));
          const done = yield* runs().deliver(threadId, {
            item: standing,
            deadline: new Date((yield* Clock.currentTimeMillis) + 60000),
          });
          if (!('runId' in done)) return yield* Effect.die(new Error('the delivery was spent'));
          return done;
        }),
      };
      return Object.assign(made, said);
    });
    const reading = (threadId: string) =>
      Effect.map(
        store.db.get<{
          readonly reading: string | null;
        }>(sql`select context_reading as reading from native_thread where id = ${threadId}`),
        (row): ThreadContextReading | null => (row?.reading == null ? null : JSON.parse(row.reading)),
      );
    const events = (threadId: string) => log.eventsAfter(threadId, 0, 100);
    const stageOf = (threadId: string) =>
      Effect.map(
        store.db.get<{
          readonly stage: string | null;
        }>(
          sql`select json_extract(progress, '$.stage') as stage from thread_run where thread_id = ${threadId} order by created_at desc limit 1`,
        ),
        (row) => row?.stage ?? null,
      );
    const spentOf = (threadId: string) =>
      Effect.map(
        store.db.get<{
          readonly usage: string | null;
        }>(sql`select usage from thread_run where thread_id = ${threadId} order by created_at desc limit 1`),
        (row): Readonly<Record<string, number>> | null => (row?.usage == null ? null : JSON.parse(row.usage)),
      );
    return {
      get harness() {
        return served().harness;
      },
      recover: () => Effect.suspend(() => served().harness.runs.recoverNow()),
      driver,
      sessionStore,
      inbox,
      terminals,
      list: threads.list,
      entries,
      endEntries,
      events,
      usages,
      rows,
      turns,
      units,
      reading,
      get journal() {
        return served().journal;
      },
      held,
      pictures,
      stageOf,
      spentOf,
    };
  });
  return { installation, stage, world, files, agentBinary, openThread, floor, changes, replaceHost };
});

export class ProtocolRig extends Context.Service<ProtocolRig, Effect.Success<ReturnType<typeof protocolRig>>>()('testing/ProtocolRig') {}

const unattendedAccounts = Layer.succeed(
  HarnessAccounts,
  HarnessAccounts.of({
    defaultSignedIn: Stream.empty,
    owns: () => Effect.succeed(false),
    launchable: () => Effect.succeed(false),
    launch: () => Effect.succeed(null),
    status: () => Effect.die('directory status is not used on this protocol rig'),
    begin: () => Effect.die('CLI sign-in is not used on this protocol rig'),
    complete: () => Effect.die('CLI sign-in is not used on this protocol rig'),
    cancel: () => Effect.die('CLI sign-in is not used on this protocol rig'),
    rename: () => Effect.die('directory labels are not used on this protocol rig'),
    remove: () => Effect.die('directory removal is not used on this protocol rig'),
  }),
);

export const protocolFixture = (fixture: string, readers?: number) =>
  Layer.effect(ProtocolRig, protocolRig(fixture, readers)).pipe(
    Layer.provide(Layer.mergeAll(platform, builtinRegistry, unattendedAccounts)),
  );
