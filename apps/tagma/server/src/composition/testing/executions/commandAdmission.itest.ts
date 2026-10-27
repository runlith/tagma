import { unthreadedCaller } from '../callers';
import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sessionIdentityLayer, sessionIdentity } from '../../../external-harnesses/sessionPrefix.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Fiber, Layer, Option, Queue, type Result, Schedule, Schema, Stream } from 'effect';
import { removeRule, writeRule } from '../../../executions/testing/doubles.js';
import { Git, GitNotAdmitted } from '@runlith/git/Git';
import { currentRules } from '../../../executions/store/standingRules.js';
import type { Commands } from '@runlith/executions/Commands';
import type { ExecutionFeedItem, Executions, ExecutionsFailure, RecordChunk } from '@runlith/executions/Executions';
import type { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import type { ExecutionEvidence } from '@runlith/executions/ExecutionEvidence';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { ExecutionRecord } from '@runlith/executions/ExecutionRecord';
import type { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { TerminalInput } from '@runlith/executions/TerminalInput';
import type { TerminalLanes } from '@runlith/executions/TerminalLanes';
import type { TerminalScreen } from '@runlith/executions/TerminalScreen';
import { WireUnavailable } from '@runlith/executions/Executions';
import { Principal } from '@runlith/executions/protocol/custody';
import {
  type ExecutionState,
  type NativeExit,
  ExecutionId,
  InstallationId,
  HostRequestKey,
  type ExecutionRef,
  type HostRequestRef,
} from '@runlith/executions/protocol/execution';
import type { CallDecision } from '@runlith/executions/protocol/call';
import type { ExecutionSummary, OperationAnswer, RuntimeStatus } from '@runlith/executions/protocol/runtime';
import type { LaunchRequest, StartAnswer } from '@runlith/executions/protocol/launch';
import type { CapabilityProfile, ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import type { CommandRevisionAnswer, CommandSnapshot } from '@runlith/executions/protocol/command';
import type { CommandBatch } from '@runlith/executions/protocol/inventory';
import type { EndingReceipt, StopReceipt } from '@runlith/executions/protocol/stop';
import { ByteOffset, byteOffset, type ByteCursor } from '@runlith/executions/protocol/record';
import { makeSealedRecord } from '@runlith/executions/RecordFiles';
import { CRC32_INITIAL, crc32Final, crc32Update, encodeSegmentHeader, segmentFile } from '@runlith/executions/recordFormat';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { FileSystem } from 'effect';
import { RipgrepBinary } from '../../../platform/contract/service/ripgrep.js';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import { resolveRipgrepPath } from '@runlith/ripgrep';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { fixtureRoot } from '../../../platform/testing/roots.js';
import { OWN_GIT_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { projectsLayer } from '../../../projects/testing/doubles.js';
import { eq } from 'drizzle-orm';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { ThreadLineage } from '../../../workspace/contract/service/assignments.js';
import { Coverage, FileRoots, RootUses } from '../../../workspace/contract/service/roots.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

const machineWorld = makeMachineWorld(() => null);
import { fixtureNativeCatalog as nativeCatalog } from '../nativeCatalog.js';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { tagIndex } from '../../../graph/testing/doubles.js';
import { TargetKey, targetCwd } from '../../../executions/contract/wire/targets.js';
import type { TerminalActor } from '../../../executions/contract/wire/terminals.js';
import type { CommandCreator, CommandReading, CommandWaitMode } from '../../../executions/contract/wire/commands.js';
import type { CommandSubject } from '../../../executions/contract/wire/commandSubject.js';
import { lineageOver } from '../../../workspace/testing/lineage.js';
import { ToolAnswer, toolExecute, toolPrepare, type Tool } from '@runlith/agent/tool';
import { admittedGit } from '../../../executions/testing/doubles.js';
import { servingGit } from '../../../executions/testing/doubles.js';
import {
  CommandAccess,
  type AwaitPreparation,
  type CommandPreparation,
  type LaunchPreparation,
  type ObservePreparation,
  type RevisePreparation,
  type StopPreparation,
} from '../../../executions/contract/service/access.js';
import { CommandReader, CommandWaiters } from '../../../executions/contract/service/commands.js';
import type { CallDebts } from '../../../executions/contract/service/notices.js';
import type { TerminalRefused } from '../../../executions/contract/wire/refusals.js';
import { commandAdmission } from '../../../executions/testing/doubles.js';
import { commandOutputReader, commandOutputSearch } from '../../../executions/testing/doubles.js';
import { storedCommands } from '../../../executions/testing/doubles.js';
import { executionTargets } from '../../../executions/testing/doubles.js';
import { terminalEndings, watchedQueue } from '../../../executions/testing/doubles.js';
import { waitersOver } from '../../../executions/testing/waitersFixture.js';
import { guardedFloor } from '../../../executions/testing/guardedFloor.js';
import { callDebts, callEndings, commandDelivery, asCommandSignalSend } from '../../../threads/testing/doubles.js';
import { type AgentCalls, makeAgentCalls } from '@runlith/agent/AgentCalls';
import type { CallAddress, CallRecord } from '@runlith/agent/callProgress';
import { hostConnection } from '../../../executions/testing/doubles.js';
import { terminalExecutions, admitCommands } from '../../../executions/testing/doubles.js';
import { Custody } from '../../../executions/contract/service/custody.js';
import { Discharge } from '../../../executions/contract/service/discharge.js';
import { ExecutionHost } from '../../../executions/contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../../../executions/contract/service/records.js';
import { ManagedCommands } from '../../../executions/contract/service/commands.js';
import { TerminalRequests, Terminals, type TerminalStart } from '../../../executions/contract/service/terminals.js';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import { sweepKeyOf } from '../../../executions/testing/doubles.js';
import { terminalThreads } from '../../../executions/testing/doubles.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { BEHAVIOUR_REGISTRY } from '../../manifest.js';

const installation = InstallationId.make('command-admission');
const holder = ThreadId.make('thread-command-holder');
const swept = ThreadId.make('thread-command-swept');
const fenced = ThreadId.make('thread-command-fenced');

const undeclared = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> =>
  new WireUnavailable({ kind: 'unreachable', reason: `this fixture declares no answer for ${verb}`, sent: false });

const searchPlatform = Layer.mergeAll(
  BunFileSystem.layer,
  BunPath.layer,
  BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
  Layer.succeed(RipgrepBinary, { path: () => Effect.promise(() => resolveRipgrepPath()) }),
);

const readingFixture = (
  reader: Effect.Success<ReturnType<typeof storedCommands>>,
  search: Effect.Success<ReturnType<typeof commandOutputSearch>>,
  output?: ReturnType<typeof commandOutputReader>,
): CommandReader['Service'] => ({
  ...reader,
  ...search,
  output: output?.output ?? (() => Effect.die(new Error('command output unavailable in fixture'))),
  follow: () => Stream.die(new Error('command feed unavailable in fixture')),
});

type HostAnswers = {
  readonly start?: (operation: HostRequestRef, launch: LaunchRequest) => Effect.Effect<StartAnswer, ExecutionsFailure>;
  readonly capabilities?: () => Effect.Effect<CapabilityProfile, ExecutionsFailure>;
  readonly operation?: () => Effect.Effect<OperationAnswer, ExecutionsFailure>;
  readonly state?: () => Effect.Effect<ExecutionSummary | undefined, ExecutionsFailure>;
  readonly stop?: (execution: ExecutionRef) => Effect.Effect<StopReceipt, ExecutionsFailure>;
  readonly ending?: () => Effect.Effect<EndingReceipt | undefined, ExecutionsFailure>;
  readonly command?: () => Effect.Effect<CommandSnapshot | undefined, ExecutionsFailure>;
  readonly subscribe?: () => Stream.Stream<ExecutionFeedItem, ExecutionsFailure>;
  readonly revise?: (request: { readonly expected: number }) => Effect.Effect<CommandRevisionAnswer, ExecutionsFailure>;
  readonly read?: (cursor: ByteCursor, limit: number) => Effect.Effect<RecordChunk, ExecutionsFailure>;
  readonly commandsAt?: () => Effect.Effect<CommandBatch, ExecutionsFailure>;
  readonly status?: () => Effect.Effect<RuntimeStatus, ExecutionsFailure>;
};

type ControlledHost = {
  readonly port: Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  readonly asked: () => Readonly<Record<string, number>>;
};

const hostThat = (answers: HostAnswers): ControlledHost => {
  const asked: Record<string, number> = {};
  const count = (verb: string) => {
    asked[verb] = (asked[verb] ?? 0) + 1;
  };
  const port = {
    status: () => {
      count('status');
      return answers.status?.() ?? undeclared<RuntimeStatus>('status');
    },
    list: () => undeclared<never>('list'),
    changes: () => undeclared<never>('changes'),
    state: () => {
      count('state');
      return answers.state?.() ?? undeclared<ExecutionSummary | undefined>('state');
    },
    operation: () => {
      count('operation');
      return answers.operation?.() ?? undeclared<OperationAnswer>('operation');
    },
    callResult: () => undeclared<never>('callResult'),
    start: (operation: HostRequestRef, launch: LaunchRequest) => {
      count('start');
      return answers.start?.(operation, launch) ?? undeclared<StartAnswer>('start');
    },
    cancelStart: () => undeclared<never>('cancelStart'),
    read: (cursor: ByteCursor, limit: number) => {
      count('read');
      return answers.read?.(cursor, limit) ?? undeclared<RecordChunk>('read');
    },
    subscribe: () => {
      count('subscribe');
      return answers.subscribe?.() ?? Stream.fromEffect(undeclared<never>('subscribe'));
    },
    screen: () => undeclared<never>('screen'),
    point: () => undeclared<never>('point'),
    input: () => undeclared<never>('input'),
    signal: () => undeclared<never>('signal'),
    processes: () => undeclared<never>('processes'),
    listeners: () => undeclared<never>('listeners'),
    hostListeners: () => undeclared<never>('hostListeners'),
    capabilities: () => answers.capabilities?.() ?? undeclared<CapabilityProfile>('capabilities'),
    generation: () => undeclared<never>('generation'),
    served: () => undeclared<never>('served'),
    custody: () => undeclared<never>('custody'),
    stop: (_operation: HostRequestRef, execution: ExecutionRef) => {
      count('stop');
      return answers.stop?.(execution) ?? undeclared<StopReceipt>('stop');
    },
    retire: () => undeclared<never>('retire'),
    ending: () => {
      count('ending');
      return answers.ending?.() ?? undeclared<EndingReceipt | undefined>('ending');
    },
    retained: () => undeclared<never>('retained'),
    command: () => {
      count('command');
      return answers.command?.() ?? undeclared<CommandSnapshot | undefined>('command');
    },
    commands: () => undeclared<never>('commands'),
    commandsAt: () => {
      count('commandsAt');
      return answers.commandsAt?.() ?? undeclared<CommandBatch>('commandsAt');
    },
    revise: (request) => {
      count('revise');
      return answers.revise?.(request) ?? undeclared<CommandRevisionAnswer>('revise');
    },
    take: () => undeclared<never>('take'),
    fence: () => undeclared<never>('fence'),
    release: () => undeclared<never>('release'),
    grant: () => undeclared<never>('grant'),
    openBinding: () => undeclared<never>('openBinding'),
    closeBinding: () => undeclared<never>('closeBinding'),
    open: () => undeclared<never>('open'),
    inputs: () => undeclared<never>('inputs'),
    quiesce: () => undeclared<never>('quiesce'),
    resume: () => undeclared<never>('resume'),
    prepare: () => undeclared<never>('prepare'),
    yield: () => undeclared<never>('yield'),
    shutdown: () => undeclared<never>('shutdown'),
    pace: () => undeclared<never>('pace'),
    disown: () => undeclared<never>('disown'),
    endResidual: () => undeclared<never>('endResidual'),
    endProcess: () => undeclared<never>('endProcess'),
    load: () => undeclared<never>('load'),
    foreground: () => undeclared<never>('foreground'),
  } satisfies Executions['Service'] &
    Commands['Service'] &
    ExecutionRequest['Service'] &
    ExecutionRecord['Service'] &
    ExecutionFeed['Service'] &
    TerminalScreen['Service'] &
    TerminalInput['Service'] &
    TerminalLanes['Service'] &
    ExecutionCustody['Service'] &
    ExecutionEvidence['Service'] &
    HostAuthority['Service'] &
    HostLifecycle['Service'];
  return { port, asked: () => asked };
};

const owned = fixtureRoot('command-admission', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'a-'));
const checkout = join(home, 'checkout');
mkdirSync(join(checkout, 'src'), { recursive: true });

afterAll(() => rmSync(home, { force: true, recursive: true }));

const environment = hostWorkspace(machineWorld).pipe(
  Layer.provide(worktreeRecordsLayer),
  Layer.provideMerge(unitsLayer(MachineUnits, MachineStore)),
  Layer.provideMerge(fixtureGraph({ sourcePath: checkout }).pipe(Layer.provideMerge(projectsLayer()))),
  Layer.provideMerge(
    Layer.unwrap(
      Effect.map(sharedPool, (pool) => Layer.orDie(machineFileLayer(join(home, 'db.sqlite'), fixtureMigrations, { durable: false }, pool))),
    ),
  ),
  Layer.provideMerge(sessionIdentityLayer),
);

type Services = Layer.Success<typeof environment>;

const bornIn = Effect.fnUntraced(function* (projectId: number, thread: ThreadId) {
  const store = yield* MachineStore;
  const at = new Date(yield* Clock.currentTimeMillis);
  return yield* bornThread(
    store.db,
    {
      id: thread,
      ownerId: 'owner',
      agentId: 'tagma',
      spawnRootId: thread,
      cacheGroup: thread,
      authority: THREAD_AUTHORITY_DEFAULT,
      createdAt: at,
      updatedAt: at,
    },
    { projectId },
  );
});

const seeded = Effect.gen(function* () {
  const git = yield* Git;
  yield* runGit(git, 'fixture', ['-C', checkout, 'init', '-q', '-b', 'main', '.']);
  yield* Effect.promise(() => Bun.write(join(checkout, 'src', 'a.ts'), 'export const one = 1;\n'));
  yield* runGit(git, 'fixture', ['-C', checkout, 'add', '--', 'src']);
  yield* runGit(git, 'fixture', ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'as it stood']);
  const store = yield* MachineStore;
  const rows = yield* store.db
    .insert(projectRow())
    .values({ name: 'commands', repoKey: 'commands-key', rootPath: checkout, createdAt: new Date(yield* Clock.currentTimeMillis) })
    .returning({ id: projectRow().id });
  const projectId = rows[0]?.id ?? 0;
  for (const thread of [holder, swept, fenced]) yield* bornIn(projectId, thread);
  yield* (yield* Coverage).cover(projectId);
  const targets = yield* executionTargets();
  return {
    store,
    units: yield* MachineUnits,
    rootUses: yield* RootUses,
    fileRoots: yield* FileRoots,
    projectId,
    targets,
    resolved: yield* targets.resolve({ projectId, kind: 'host', cwd: checkout }),
    terminalStore: storesOver(store.db, installation),
    handedBackEndings: yield* Queue.unbounded<ExecutionRef>(),
  };
});

class Fixture extends Context.Service<Fixture, Effect.Success<typeof seeded>>()('commandAdmission/Fixture') {}

const threadRow = Effect.fnUntraced(function* (thread: ThreadId) {
  const { store, projectId } = yield* Fixture;
  return yield* bornIn(projectId, thread);
});

const waitersFor = Effect.fnUntraced(function* (ended?: Queue.Queue<ExecutionRef>, debts?: CallDebts) {
  const { terminalStore, handedBackEndings } = yield* Fixture;
  return yield* waitersOver(terminalStore.deliveries, ended ?? handedBackEndings, debts);
});

const floorOver = Effect.fnUntraced(function* (host: ControlledHost, waiters?: CommandWaiters['Service']) {
  const { store, units, terminalStore } = yield* Fixture;
  const watched = yield* watchedQueue();
  const floor = yield* guardedFloor({
    port: host.port,
    guarded: host.port,
    db: store.db,
    installation,
    watched,
    waiters: waiters ?? (yield* waitersFor()),
  });
  const access = yield* commandAdmission({
    commandRows: terminalStore.commandRows,
    register: terminalThreads({ db: store.db }),
    executions: host.port,
    rules: (project, thread, home) => Effect.map(currentRules(store, project, thread, home), (standing) => standing.map((one) => one.rule)),
  }).pipe(Effect.provideServiceEffect(ThreadLineage, lineageOver(store, units)));
  return { terminals: floor.terminals, reconciliation: floor.reconciliation, access, watched };
});

type Floor = Effect.Success<ReturnType<typeof floorOver>>;

const execution = (id: string): ExecutionRef => ({
  installation,
  execution: ExecutionId.make(id),
  incarnation: 1,
});

const commandState = (ref: ExecutionRef): ExecutionState => ({
  ref,
  transport: 'pipes',
  lifetime: 'command',
  purpose: 'internal',
  phase: 'queued',
  streams: { stdout: 'open', stderr: 'open', pty: 'eof' },
  cleanup: 'pending',
  record: 'available',
});

const endedState = (ref: ExecutionRef, nativeExit?: NativeExit): ExecutionState => ({
  ...commandState(ref),
  phase: 'ended',
  nativeExit,
  streams: { stdout: 'eof', stderr: 'eof', pty: 'eof' },
});

const acceptedAs = (admitted: ExecutionRef) => (operation: HostRequestRef) =>
  Effect.succeed({ _tag: 'Accepted' as const, operation, execution: admitted, state: commandState(admitted) });

const summaryOf = (state: ExecutionState, streams: ExecutionSummary['streams'] = []): ExecutionSummary => ({
  state,
  custody: {
    revision: 0,
    holder: Principal.make(`thread:${holder}`),
    origin: Principal.make(`thread:${holder}`),
    target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
  },
  streams,
  native: {},
  input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
});

const asLaunch = (prepared: CommandPreparation): LaunchPreparation => {
  const { request, receipt } = prepared;
  if (request._tag !== 'Launch' || receipt === undefined) throw new Error('the fixture prepared no launch');
  return { ...prepared, request, receipt };
};

const launchOf = Effect.fnUntraced(function* (
  access: CommandAccess['Service'],
  operationId: string,
  actor: TerminalActor,
  owner: CommandSubject,
  creator: CommandCreator,
  requested?: number,
) {
  const { projectId, resolved } = yield* Fixture;
  return asLaunch(
    yield* access.prepare({
      _tag: 'Launch',
      actor,
      scope: projectId,
      target: resolved,
      program: '/bin/sh',
      args: ['-c', 'true'],
      tool: 'bash',
      requested,
      owner,
      creator,
      operation: HostRequestKey.make(operationId),
    }),
  );
});

const startOf = Effect.fnUntraced(function* (
  operationId: string,
  actor: TerminalActor,
  prepared: LaunchPreparation,
  access: CommandAccess['Service'],
  wait?: CommandWaitMode,
  label?: string,
): Effect.fn.Return<TerminalStart, never, Fixture> {
  return {
    actor,
    operationId: HostRequestKey.make(operationId),
    target: (yield* Fixture).resolved,
    targetKey: prepared.targetKey,
    program: '/bin/sh',
    args: ['-c', 'true'],
    transport: 'pipes',
    lifetime: 'call',
    purpose: 'internal',
    command: {
      prepared,
      recheck: (unit) => access.recheck(unit, prepared),
      wait,
      label,
    },
  };
});

const creatorOf = (thread: ThreadId): CommandCreator => ({ _tag: 'Thread', thread, run: 'run-1', toolCall: 'call-1' });

const actorOf = Effect.fnUntraced(function* (thread: ThreadId = holder): Effect.fn.Return<TerminalActor, never, Fixture> {
  return { _tag: 'Thread', threadId: thread, projectId: (yield* Fixture).projectId };
});

const holderOwner: CommandSubject = { _tag: 'Thread', thread: holder };

const attempted = Effect.fnUntraced(function* (
  floor: Floor,
  operationId: string,
  actor: TerminalActor,
  owner: CommandSubject,
  creator: CommandCreator,
  wait?: CommandWaitMode,
) {
  const prepared = yield* launchOf(floor.access, operationId, actor, owner, creator);
  return yield* Effect.result(Effect.scoped(floor.terminals.start(yield* startOf(operationId, actor, prepared, floor.access, wait))));
});

const launched = Effect.fnUntraced(function* (floor: Floor, operationId: string, wait?: CommandWaitMode, label?: string) {
  const actor = yield* actorOf();
  const prepared = yield* launchOf(floor.access, operationId, actor, holderOwner, creatorOf(holder));
  const receipt = yield* Effect.scoped(floor.terminals.start(yield* startOf(operationId, actor, prepared, floor.access, wait, label)));
  return { actor, prepared, receipt };
});

const asStop = (prepared: CommandPreparation): StopPreparation => {
  const { request } = prepared;
  if (request._tag !== 'Stop') throw new Error('the fixture prepared no stop');
  return { ...prepared, request };
};

const asRevise = (prepared: CommandPreparation): RevisePreparation => {
  const { request, revision } = prepared;
  if (request._tag !== 'Revise' || revision === undefined) throw new Error('the fixture prepared no revision');
  return { ...prepared, request, revision };
};

const asAwait = (prepared: CommandPreparation): AwaitPreparation => {
  const { request } = prepared;
  if (request._tag !== 'Await') throw new Error('the fixture prepared no wait');
  return { ...prepared, request };
};

const asObserve = (prepared: CommandPreparation): ObservePreparation => {
  const { request } = prepared;
  if (request._tag !== 'Observe') throw new Error('the fixture prepared no observation');
  return { ...prepared, request };
};

const stopAuthority = Effect.fnUntraced(function* (floor: Floor, actor: TerminalActor) {
  const { projectId } = yield* Fixture;
  return (ref: ExecutionRef) =>
    Effect.map(floor.access.prepare({ _tag: 'Stop', actor, scope: projectId, execution: ref }), (act) => ({
      prepared: asStop(act),
      recheck: (unit: Unit<'machine'>) => floor.access.recheck(unit, act),
    }));
});

const stopOf = Effect.fnUntraced(function* (
  floor: Floor,
  operationId: string,
  stopper: TerminalActor,
  requester: string,
  targetKey: TargetKey,
  ref: ExecutionRef,
) {
  const { projectId } = yield* Fixture;
  return floor.terminals.commands.stop(
    projectId,
    {
      projectId,
      operationId: HostRequestKey.make(operationId),
      requester: Principal.make(requester),
      mutation: 'stop',
      targetKey,
      execution: ref,
    },
    ref,
    yield* (yield* stopAuthority(floor, stopper))(ref),
    'explicit-stop',
    'signal',
  );
});

const sweepOf = Effect.fnUntraced(function* (
  floor: Floor,
  operationId: string,
  thread: ThreadId,
  actor: TerminalActor,
  owner: CommandSubject,
) {
  const { projectId } = yield* Fixture;
  return {
    key: sweepKeyOf(projectId, HostRequestKey.make(operationId), Principal.make(`thread:${thread}`), [owner]),
    authorize: yield* stopAuthority(floor, actor),
  };
});

const refusedReason = <A, E extends { readonly _tag: string }>(result: Result.Result<A, E>) =>
  result._tag === 'Failure' && result.failure._tag === 'TerminalRefused'
    ? (result.failure as unknown as TerminalRefused).reason
    : result._tag;

const commandRow = Effect.fnUntraced(function* (id: string) {
  const { units, terminalStore } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.commandRows.recordCommand(unit, id));
});

const waitOf = Effect.fnUntraced(function* (ref: ExecutionRef) {
  const { units, terminalStore } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.deliveries.commandWait(unit, ref));
});

const deliveryOf = Effect.fnUntraced(function* (ref: ExecutionRef) {
  const { units, terminalStore } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.deliveries.delivery(unit, ref));
});

const fenceOf = Effect.fnUntraced(function* (owner: CommandSubject) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.commandRows.ownerFence(unit, projectId, owner));
});

const operationState = Effect.fnUntraced(function* (operationId: string) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.requestKeys.operation(unit, projectId, HostRequestKey.make(operationId)));
});

const intentOf = Effect.fnUntraced(function* (operationId: string) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.intents.intent(unit, projectId, HostRequestKey.make(operationId)));
});

const heldBy = Effect.fnUntraced(function* (operationId: string) {
  const { units, rootUses, resolved } = yield* Fixture;
  return yield* units.read((unit) =>
    Effect.map(
      rootUses.holding(
        unit,
        resolved.footprint.roots.map((overlap) => overlap.root.rootId),
      ),
      (uses) => uses.filter((use) => use.consumer.id === operationId && use.state === 'held'),
    ),
  );
});

const receiptFor = (ref: ExecutionRef, over: Partial<StopReceipt> = {}): StopReceipt => ({
  operation: { installation, operation: HostRequestKey.make('op-stopping') },
  execution: ref,
  requested: 'signal',
  cause: 'explicit-stop',
  steps: ['interrupt'],
  cost: { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this fake host reads no accounting' },
  coverage: [],
  relation: 'leader',
  confirmed: [],
  residual: [],
  unverifiable: [],
  streams: [],
  cleanup: 'complete',
  retention: 'retained',
  abandonedOutput: false,
  ...over,
});

const endingOf = (ref: ExecutionRef): EndingReceipt => {
  const { operation: _op, requested: _requested, cause: _cause, steps: _steps, ...ended } = receiptFor(ref);
  return ended;
};

const snapshotOf = (projectId: number, ref: ExecutionRef): CommandSnapshot => ({
  admission: {
    origin: { scope: `project:${projectId}`, owner: `thread:${holder}`, cohort: 'policy-1' },
    limits: { executionMs: 60000, executionCeilingMs: 100, origin: 'rule' },
    policyIdentity: 'policy-1',
  },
  state: {
    ref,
    transport: 'pipes',
    lifetime: 'command',
    purpose: 'internal',
    phase: 'running',
    streams: { stdout: 'open', stderr: 'open', pty: 'eof' },
    cleanup: 'pending',
    record: 'available',
  },
  deadline: { execution: ref, revision: 2, executionMs: 40, ceilingMs: 100, origin: 'caller' },
});

const commandLaunchOf = (projectId: number): Extract<LaunchRequest, { readonly lifetime: 'command' }> => ({
  command: { program: '/bin/sh', args: ['-c', 'true'], environment: [], cwd: checkout },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'command',
  purpose: 'internal',
  admission: {
    origin: { scope: `project:${projectId}`, owner: `thread:${holder}`, cohort: 'asked' },
    limits: { executionMs: 60000, executionCeilingMs: 60000, origin: 'rule' },
    policyIdentity: 'asked',
  },
  target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
  holder: Principal.make(`thread:${holder}`),
  origin: Principal.make(`thread:${holder}`),
});

const lifeRule = Effect.fnUntraced(function* (
  thread: ThreadId | null,
  through: 'bash' | null,
  limitMs: number,
  writer: string,
  words: string,
) {
  const { store, projectId } = yield* Fixture;
  return yield* writeRule(store, {
    projectId: thread === null ? null : projectId,
    thread,
    through,
    program: null,
    measure: 'life',
    limitMs,
    writer,
    words,
    position: { at: 'end' },
  });
});

const removing = Effect.fnUntraced(function* (id: string) {
  return yield* Effect.orDie(removeRule((yield* Fixture).store, id));
});

const endedSummary = (
  admitted: ExecutionRef,
  ended: { readonly exit?: NativeExit; readonly decision?: CallDecision },
): ExecutionSummary => ({ ...summaryOf(endedState(admitted, ended.exit)), decision: ended.decision });

const PIPE_MODES = {
  _tag: 'Unavailable',
  revision: 0,
  reason: 'this execution runs on pipes, which have no terminal modes',
} as const;

const consoleOf = (said: { readonly stdout: string; readonly stderr: string }) => (cursor: ByteCursor) => {
  const whole = new TextEncoder().encode(cursor.stream === 'stderr' ? said.stderr : said.stdout);
  const from = Number(cursor.offset);
  return Effect.succeed({
    range: {
      cursor,
      next: ByteOffset.make(String(whole.length)),
      retainedFrom: ByteOffset.make('0'),
      durableThrough: ByteOffset.make(String(whole.length)),
      gap: false,
    },
    bytes: whole.slice(from),
    modes: PIPE_MODES,
  });
};

const consoleHost = (
  admitted: ExecutionRef,
  said: { readonly stdout: string; readonly stderr: string },
  ended: { readonly exit?: NativeExit; readonly decision?: CallDecision },
  read: HostAnswers['read'] = consoleOf(said),
) =>
  hostThat({
    start: acceptedAs(admitted),
    state: () =>
      Effect.succeed({
        ...endedSummary(admitted, ended),
        streams: (['stdout', 'stderr'] as const).map((stream) => ({
          stream,
          retainedFrom: ByteOffset.make('0'),
          durableThrough: ByteOffset.make(String(new TextEncoder().encode(said[stream]).length)),
          parsedThrough: ByteOffset.make('0'),
          ending: 'eof' as const,
        })),
      }),
    read,
  });

const statusOf = (admitted: ExecutionRef) => () =>
  Effect.succeed({
    installation,
    incarnation: admitted.incarnation,
    phase: 'open',
    holder: { _tag: 'Standing' },
    custody: { _tag: 'Held', holder: 'custodian' },
    executions: 1,
    memory: { granted: { _tag: 'Unbounded' }, reserved: 0, retained: 0, executions: 1, ceiling: 0 },
  } as unknown as RuntimeStatus);

const batchOf = (projectId: number, admitted: ExecutionRef, state: ExecutionState, elapsedMs: number, ending?: EndingReceipt) => () =>
  Effect.succeed({
    commands: [
      {
        admission: {
          origin: { scope: `project:${projectId}`, owner: `thread:${holder}`, cohort: 'cohort' },
          limits: { executionMs: 60_000, executionCeilingMs: 60_000, origin: 'rule' as const },
          policyIdentity: 'cohort',
        },
        state,
        deadline: {
          execution: admitted,
          revision: 0,
          executionMs: 60_000,
          ceilingMs: 60_000,
          origin: 'caller' as const,
          armed: 'native-acquired' as const,
          elapsedMs,
        },
        admittedAtMs: 0,
        ending,
      },
    ],
    revision: 1,
    unmeasured: [],
  } as CommandBatch);

const gitOver = Effect.fnUntraced(function* (floor: Floor, key: string, owner: ThreadId = holder) {
  const { targets, projectId } = yield* Fixture;
  return admittedGit({
    terminals: floor.terminals,
    commands: floor.terminals.commands,
    access: floor.access,
    targets,
    projectId,
    actor: yield* actorOf(),
    owner: { _tag: 'Thread', thread: owner },
    creator: creatorOf(holder),
    tool: 'submit_work',
    root: checkout,
    key,
    bytes: 4096,
  });
});

const gitRun = Effect.fnUntraced(function* (host: ControlledHost, key: string, args: readonly string[], owner?: ThreadId) {
  return yield* (yield* gitOver(yield* floorOver(host), key, owner)).run(args);
});

const platformGit = () => {
  const calls: (readonly string[])[] = [];
  const faces: Git['Service'] = {
    run: (args) => {
      calls.push(args);
      return Effect.succeed({ status: 0, stdout: 'platform', stderr: '', overflow: false, messageOverflow: false });
    },
  };
  return { faces, calls };
};

const gitOf = Effect.fnUntraced(function* (floor: Floor) {
  return servingGit({
    terminals: floor.terminals,
    commands: floor.terminals.commands,
    host: { ledger: floor.terminals.ledger, offersCommands: floor.terminals.offersCommands } as unknown as ExecutionHost['Service'],
    access: floor.access,
    targets: (yield* Fixture).targets,
    policy: { execution: { output: { retainedBytes: 4096 } } } as unknown as ExecutionPolicy,
  });
});

const ownersOf = Effect.fnUntraced(function* (floor: Floor, host: ControlledHost, output?: CommandWaiters['Service']) {
  const { terminalStore } = yield* Fixture;
  const reader = yield* storedCommands({ commandRows: terminalStore.commandRows, requestKeys: terminalStore.requestKeys, host: host.port });
  const search = yield* Effect.provide(commandOutputSearch({ commands: floor.terminals.commands, reader }), searchPlatform);
  const reading = readingFixture(
    reader,
    search,
    output === undefined ? undefined : commandOutputReader({ commands: floor.terminals.commands, reader, waiters: output }),
  );
  return Context.merge(
    yield* Effect.context<Services>(),
    Context.empty().pipe(
      Context.add(CommandReader, reading),
      Context.add(CommandAccess, floor.access),
      Context.add(Terminals, floor.terminals),
      Context.add(TerminalRequests, floor.terminals),
      Context.add(TerminalWriting, floor.terminals),
      Context.add(Custody, floor.terminals),
      Context.add(ExecutionRecords, floor.terminals),
      Context.add(TerminalScreens, floor.terminals),
      Context.add(ExecutionProcessEvidence, floor.terminals),
      Context.add(Discharge, floor.terminals),
      Context.add(ExecutionHost, floor.terminals),
      Context.add(ManagedCommands, floor.terminals.commands),
    ),
  );
});

const catalogOver = Effect.fnUntraced(function* (host: ControlledHost, thread: ThreadId = holder, given?: Floor) {
  const { projectId } = yield* Fixture;
  const floor = given ?? (yield* floorOver(host));
  return yield* nativeCatalog(
    {
      place: { root: checkout, origin: null },
      caller: {
        actor: {
          kind: 'thread',
          threadId: thread,
          projectId,
          principalId: 'owner',
          session: { harness: 'tagma', key: thread },
        },
        files: { path: home, resolve: (candidate: string) => join(home, candidate) },
      },
      project: { id: projectId, name: 'commands' },
      vocabulary: () => tagIndex([], BEHAVIOUR_REGISTRY),
      identity: sessionIdentity,
      world: 'checkout',
      graphRoot: checkout,
      owners: yield* ownersOf(floor, host, yield* waitersFor()),
    },
    ['read_commands', 'read_command_bytes', 'read_output', 'search_output', 'read_terminal_operation', 'stop_command'],
  );
});

const walk = Effect.fnUntraced(function* (tool: Tool, input: unknown) {
  const call = { toolCallId: 'call-under-test', caller: unthreadedCaller, messages: [] };
  const prepare = toolPrepare(tool);
  const prepared = prepare === null ? undefined : yield* prepare(input, call);
  const execute = toolExecute(tool);
  if (execute === null) return yield* Effect.die('this tool declares no body');
  return yield* execute(input, { ...call, prepared: prepared?.prepared });
});

const walked = (tool: Tool, input: unknown) =>
  Effect.map(walk(tool, input), (answered) => (answered instanceof ToolAnswer ? answered.value : answered));

const outputOf = (catalog: Record<string, Tool>, admitted: ExecutionRef, input: Record<string, unknown> = {}) =>
  walked(catalog.read_output as Tool, { execution: admitted.execution, incarnation: admitted.incarnation, ...input });

const restartedDelivery = Effect.fnUntraced(function* (name: string, moved: boolean) {
  const { units, terminalStore, projectId } = yield* Fixture;
  const admitted = execution(`exec-command-${name}`);
  const operationId = `op-command-${name}`;
  const host = hostThat({
    start: acceptedAs(admitted),
    state: () => Effect.succeed(summaryOf(endedState(admitted, { _tag: 'Code', code: 0 }))),
    ending: () => Effect.succeed(endingOf(admitted)),
  });
  const floor = yield* floorOver(host);
  const { receipt } = yield* launched(floor, operationId, moved ? 'foreground' : 'background');
  expect(receipt._tag).toBe('Accepted');
  if (moved) expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
  expect(yield* waitOf(admitted)).toEqual({ execution: admitted, mode: 'background', revision: moved ? 1 : 0 });
  expect((yield* deliveryOf(admitted))?.signalId).toBe(`command:exec-command-${name}:1:call-1`);

  const first = yield* units.read((unit) => terminalStore.commandRows.commandsHeld(unit, undefined, 1));
  expect(first.length).toBe(1);
  const rest = yield* units.read((unit) =>
    terminalStore.commandRows.commandsHeld(unit, { admittedAt: first[0]!.admittedAt, execution: first[0]!.execution.execution }, 100),
  );
  expect([...first, ...rest].find((row) => row.execution.execution === admitted.execution)?.projectId).toBe(projectId);

  const sent: { readonly threadId: string; readonly id: string; readonly text: string }[] = [];
  const send: ReturnType<typeof asCommandSignalSend> = (input) =>
    Effect.sync(() => {
      sent.push(input);
      return { _tag: 'Accepted' } as const;
    });
  const mineSent = () => sent.filter((delivered) => delivered.id === `command:exec-command-${name}:1:call-1`);
  const unmeasured = yield* Effect.scoped(
    Effect.gen(function* () {
      const watched = yield* watchedQueue();
      const ended = yield* Queue.unbounded<ExecutionRef>();
      const endings = yield* terminalEndings({
        terminals: floor.terminals,
        discharge: floor.terminals,
        terminalRows: terminalStore.terminalRows,
        commandRows: terminalStore.commandRows,
        opened: watched,
        ended,
      });
      const waiters = yield* waitersFor(ended);
      const delivery = yield* commandDelivery({ send }).pipe(
        Effect.provideService(CommandWaiters, waiters),
        Effect.provideService(Terminals, floor.terminals),
        Effect.provideService(ManagedCommands, floor.terminals.commands),
        Effect.provideService(ExecutionRecords, floor.terminals),
      );
      yield* waiters.recover();
      const measurement = yield* waiters.measurement(admitted);
      yield* endings.resume();
      yield* Effect.forkScoped(delivery.attend());
      yield* Effect.gen(function* () {
        const wait = yield* waitOf(admitted);
        const stillOwed = yield* deliveryOf(admitted);
        return wait === null && stillOwed === null && mineSent().length === 1;
      }).pipe(Effect.repeat({ until: (done) => done, schedule: Schedule.spaced('50 millis') }));
      return measurement;
    }),
  );

  const delivered = mineSent();
  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.threadId).toBe(holder);
  expect(delivered[0]?.text).toContain('exit 0');
  expect(typeof unmeasured).toBe('string');
  expect(delivered[0]?.text).toContain(unmeasured as string);
  expect(yield* commandRow(`exec-command-${name}`)).not.toBeNull();
  expect(yield* heldBy(operationId)).toEqual([]);
});

layer(Layer.provideMerge(Layer.effect(Fixture, seeded), environment), { excludeTestServices: true })('command admission', (it) => {
  it.effect('a prepared command start projects its origin, settles its key and watches once', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-1');
      const host = hostThat({ start: acceptedAs(admitted) });
      const floor = yield* floorOver(host);
      const { prepared, receipt } = yield* launched(floor, 'op-command-1');
      if (receipt._tag !== 'Accepted') return yield* Effect.die(`the start answered ${receipt._tag}`);
      expect(receipt.record.execution.execution).toBe(admitted.execution);
      expect(receipt.record.owner).toEqual(holderOwner);
      expect(receipt.record.origin).toEqual({ _tag: 'Thread', thread: holder, run: 'run-1', toolCall: 'call-1' });
      expect(receipt.record.policyIdentity).toBe(prepared.receipt.policyIdentity);
      expect(receipt.record.targetKey).toBe(prepared.targetKey);
      expect(yield* commandRow('exec-command-1')).toEqual(receipt.record);
      expect(receipt.record.holdings.rootUse).toBeDefined();
      expect(yield* operationState('op-command-1')).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf('op-command-1')).toBeNull();
      expect((yield* heldBy('op-command-1')).length).toBe(1);
      expect((yield* Queue.take(floor.watched)).execution.execution).toBe(admitted.execution);
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect('stale authority refuses before a spawn and reserves nothing', () =>
    Effect.gen(function* () {
      const host = hostThat({ start: acceptedAs(execution('exec-command-stale')) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const prepared = yield* launchOf(floor.access, 'op-command-stale', actor, holderOwner, creatorOf(holder));
      const rule = yield* lifeRule(holder, null, 5_000, 'operator', 'five seconds to live');
      yield* Effect.gen(function* () {
        const failed = yield* Effect.result(
          Effect.scoped(floor.terminals.start(yield* startOf('op-command-stale', actor, prepared, floor.access))),
        );
        expect(refusedReason(failed)).toBe('stale-authority');
        expect(host.asked()['start']).toBeUndefined();
        expect(yield* operationState('op-command-stale')).toMatchObject({ _tag: 'Unknown' });
        expect(yield* intentOf('op-command-stale')).toBeNull();
        expect(yield* heldBy('op-command-stale')).toEqual([]);
      }).pipe(Effect.ensuring(removing(rule.rule.id)));
    }),
  );

  it.effect('a taken command key answers its own acceptance, never a second launch', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-2');
      const host = hostThat({ start: acceptedAs(admitted) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const prepared = yield* launchOf(floor.access, 'op-command-2', actor, holderOwner, creatorOf(holder));
      const request = yield* startOf('op-command-2', actor, prepared, floor.access);
      expect((yield* Effect.scoped(floor.terminals.start(request)))._tag).toBe('Accepted');
      const again = yield* Effect.scoped(floor.terminals.start(request));
      expect(again._tag === 'Accepted' ? again.record.execution.execution : again._tag).toBe(admitted.execution);
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect(
    'a thread rule decides the time a bash launch is admitted under, reaches no other thread, and the command keeps its own copy',
    () =>
      Effect.gen(function* () {
        const { store } = yield* Fixture;
        const written = yield* lifeRule(holder, 'bash', 300_000, `tagma:${holder}`, 'bash gets five minutes');
        const ruled = execution('exec-command-ruled');
        const launches: LaunchRequest[] = [];
        const host = hostThat({
          start: (operation, launch) => {
            launches.push(launch);
            return acceptedAs(ruled)(operation);
          },
        });
        const floor = yield* floorOver(host);
        const actor = yield* actorOf();
        let removed = false;
        yield* Effect.gen(function* () {
          const long = yield* launchOf(floor.access, 'op-rule-long', actor, holderOwner, creatorOf(holder), 600_000);
          expect(long.receipt.limits).toEqual({ executionMs: 300_000, executionCeilingMs: 300_000, origin: 'rule' });
          expect(long.receipt.time.rules.map((copy) => copy.id)).toEqual([written.rule.id]);

          const short = yield* launchOf(floor.access, 'op-rule-short', actor, holderOwner, creatorOf(holder), 60_000);
          expect(short.receipt.limits).toEqual({ executionMs: 60_000, executionCeilingMs: 300_000, origin: 'caller' });

          const elsewhere = yield* launchOf(
            floor.access,
            'op-rule-elsewhere',
            yield* actorOf(swept),
            { _tag: 'Thread', thread: swept },
            creatorOf(swept),
          );
          expect(elsewhere.receipt.limits).toEqual({ executionMs: 3_600_000, executionCeilingMs: 21_600_000, origin: 'default' });
          expect(elsewhere.receipt.time.rules).toEqual([]);

          expect((yield* Effect.scoped(floor.terminals.start(yield* startOf('op-rule-long', actor, long, floor.access))))._tag).toBe(
            'Accepted',
          );
          const launch = launches[0];
          expect(launch?.lifetime === 'command' ? launch.admission.rules?.map((copy) => copy.id) : undefined).toEqual([written.rule.id]);
          expect(launch?.lifetime === 'command' ? launch.admission.tool : undefined).toBe('bash');

          yield* removeRule(store, written.rule.id);
          removed = true;
          const kept = yield* commandRow(ruled.execution);
          expect(kept?.time?.rules.map((copy) => copy.id)).toEqual([written.rule.id]);
          expect(kept?.time?.requested).toBe(600_000);
        }).pipe(Effect.ensuring(Effect.suspend(() => (removed ? Effect.void : removing(written.rule.id)))));
      }),
  );

  it.effect("a machine rule bounds a launch of every thread, and a thread's looser rule does not lengthen it", () =>
    Effect.gen(function* () {
      const machineRule = yield* lifeRule(null, null, 60_000, 'operator', 'one minute on every command, everywhere');
      const looser = yield* lifeRule(holder, 'bash', 90_000, `tagma:${holder}`, 'ninety seconds here');
      const floor = yield* floorOver(hostThat({}));
      yield* Effect.gen(function* () {
        const held = yield* launchOf(floor.access, 'op-machine-held', yield* actorOf(), holderOwner, creatorOf(holder));
        expect(held.receipt.limits).toEqual({ executionMs: 60_000, executionCeilingMs: 60_000, origin: 'rule' });
        expect(held.receipt.time.rules).toMatchObject([{ id: machineRule.rule.id, machine: true }]);
        const other = yield* launchOf(
          floor.access,
          'op-machine-other',
          yield* actorOf(swept),
          { _tag: 'Thread', thread: swept },
          creatorOf(swept),
          600_000,
        );
        expect(other.receipt.limits).toEqual({ executionMs: 60_000, executionCeilingMs: 60_000, origin: 'rule' });
      }).pipe(Effect.ensuring(Effect.andThen(removing(looser.rule.id), removing(machineRule.rule.id))));
    }),
  );

  it.effect('a command start carrying terminal-only shapes refuses without reaching the host', () =>
    Effect.gen(function* () {
      const host = hostThat({ start: acceptedAs(execution('exec-command-shapes')) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const prepared = yield* launchOf(floor.access, 'op-command-shape', actor, holderOwner, creatorOf(holder));
      const base = yield* startOf('op-command-shape', actor, prepared, floor.access);
      const shapes: ReadonlyArray<TerminalStart> = [
        { ...base, operationId: HostRequestKey.make('op-command-pty'), transport: 'pty', geometry: { rows: 24, columns: 80 } },
        { ...base, operationId: HostRequestKey.make('op-command-budget'), budget: {} },
        { ...base, operationId: HostRequestKey.make('op-command-interactive'), interactive: { revision: 0 } },
      ];
      for (const shape of shapes) {
        expect(refusedReason(yield* Effect.result(Effect.scoped(floor.terminals.start(shape))))).toBe('ineligible');
      }
      expect(host.asked()['start']).toBeUndefined();
    }),
  );

  it.effect('a lost command reply keeps its fence and obligations until the key recovers them', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-3');
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }),
        operation: () =>
          Effect.succeed({
            _tag: 'Accepted' as const,
            operation: { installation, operation: HostRequestKey.make('op-command-3') },
            execution: admitted,
          }),
        state: () => Effect.succeed(summaryOf({ ...commandState(admitted), phase: 'running' as const })),
      });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const prepared = yield* launchOf(floor.access, 'op-command-3', actor, holderOwner, creatorOf(holder));
      const request = yield* startOf('op-command-3', actor, prepared, floor.access, 'background');
      expect((yield* Effect.result(Effect.scoped(floor.terminals.start(request))))._tag).toBe('Failure');
      expect(yield* operationState('op-command-3')).toMatchObject({ _tag: 'Uncertain' });
      expect((yield* intentOf('op-command-3'))?.phase).toBe('uncertain');
      expect((yield* heldBy('op-command-3')).length).toBe(1);
      expect((yield* floor.terminals.request(projectId, HostRequestKey.make('op-command-3')))._tag).toBe('Admitted');
      expect((yield* floor.reconciliation.operation(projectId, HostRequestKey.make('op-command-3')))._tag).toBe('Settled');
      expect((yield* commandRow('exec-command-3'))?.origin).toEqual({ _tag: 'Thread', thread: holder, run: 'run-1', toolCall: 'call-1' });
      expect(yield* waitOf(admitted)).toEqual({ execution: admitted, mode: 'background', revision: 0 });
      const again = yield* Effect.scoped(floor.terminals.start(request));
      expect(again._tag === 'Accepted' ? again.record.execution.execution : again._tag).toBe(admitted.execution);
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect('operator and service owners project their own arms', () =>
    Effect.gen(function* () {
      const operator: TerminalActor = { _tag: 'Operator' };
      const cases: ReadonlyArray<{ readonly operationId: string; readonly executionId: string; readonly owner: CommandSubject }> = [
        { operationId: 'op-command-operator', executionId: 'exec-command-operator', owner: { _tag: 'Operator' } },
        { operationId: 'op-command-service', executionId: 'exec-command-service', owner: { _tag: 'Service', scope: 'scope-1' } },
      ];
      for (const { operationId, executionId, owner } of cases) {
        const floor = yield* floorOver(hostThat({ start: acceptedAs(execution(executionId)) }));
        const prepared = yield* launchOf(floor.access, operationId, operator, owner, { _tag: 'Operator' });
        const receipt = yield* Effect.scoped(floor.terminals.start(yield* startOf(operationId, operator, prepared, floor.access)));
        expect(receipt).toMatchObject({ _tag: 'Accepted', record: { owner, origin: { _tag: 'Operator' } } });
      }
    }),
  );

  it.effect("only a thread's own command is launched paced: Tagma's work under the thread and the operator's command are not", () =>
    Effect.gen(function* () {
      const launches: LaunchRequest[] = [];
      const holderActor = yield* actorOf();
      const cases: ReadonlyArray<{
        readonly operationId: string;
        readonly actor: TerminalActor;
        readonly owner: CommandSubject;
        readonly creator: CommandCreator;
        readonly purpose: 'command' | 'internal';
      }> = [
        { operationId: 'op-paced-thread', actor: holderActor, owner: holderOwner, creator: creatorOf(holder), purpose: 'command' },
        { operationId: 'op-paced-support', actor: holderActor, owner: holderOwner, creator: creatorOf(holder), purpose: 'internal' },
        {
          operationId: 'op-paced-operator',
          actor: { _tag: 'Operator' },
          owner: { _tag: 'Operator' },
          creator: { _tag: 'Operator' },
          purpose: 'command',
        },
      ];
      for (const { operationId, actor, owner, creator, purpose } of cases) {
        const admitted = execution(`exec-${operationId}`);
        const floor = yield* floorOver(
          hostThat({
            start: (operation, launch) => {
              launches.push(launch);
              return acceptedAs(admitted)(operation);
            },
          }),
        );
        const prepared = yield* launchOf(floor.access, operationId, actor, owner, creator);
        const receipt = yield* Effect.scoped(
          floor.terminals.start({ ...(yield* startOf(operationId, actor, prepared, floor.access)), purpose }),
        );
        expect(receipt._tag).toBe('Accepted');
      }
      expect(launches.map((launch) => launch.paced ?? false)).toEqual([true, false, false]);
    }),
  );

  it.effect('a stop that proved a clean ending settles its key and discharges, keeping attribution', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-stop');
      const host = hostThat({ start: acceptedAs(admitted), stop: () => Effect.succeed(receiptFor(admitted)) });
      const floor = yield* floorOver(host);
      const { actor, prepared, receipt: started } = yield* launched(floor, 'op-command-stop');
      expect(started._tag).toBe('Accepted');
      const receipt = yield* yield* stopOf(floor, 'op-command-stop-stop', actor, `thread:${holder}`, prepared.targetKey, admitted);
      expect(receipt.cleanup).toBe('complete');
      expect(yield* operationState('op-command-stop-stop')).toMatchObject({ _tag: 'Settled' });
      expect((yield* commandRow('exec-command-stop'))?.owner).toEqual(holderOwner);
      expect(yield* heldBy('op-command-stop')).toEqual([]);
      expect(host.asked()['stop']).toBe(1);
    }),
  );

  it.effect('a lost stop reply recovers its resource populations through the same operation key', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-stop-recovery');
      const operationId = 'op-stop-recovery';
      const receipt = receiptFor(admitted, {
        operation: { installation, operation: HostRequestKey.make(operationId) },
        confirmed: [{ pid: 4201, relation: 'leader', exit: { _tag: 'Signal', signal: 'SIGINT' }, step: 'interrupt' }],
        residual: [{ kind: 'process', pid: 4202, detail: 'child still holds its pipe' }],
        unverifiable: [{ kind: 'callback', detail: 'callback owner did not answer', reason: 'unreachable' }],
        cleanup: 'pending',
      });
      const host = hostThat({ start: acceptedAs(admitted), stop: () => Effect.succeed(receipt) });
      yield* launched(yield* floorOver(host), 'op-stop-recovery-start');
      const tools = yield* catalogOver(host);
      yield* walk(tools.stop_command as Tool, {
        operationId,
        execution: admitted.execution,
        incarnation: admitted.incarnation,
        cause: 'explicit-stop',
      });
      const recovered = yield* walk(tools.read_terminal_operation as Tool, { operationId });
      expect(recovered instanceof ToolAnswer ? recovered.value : recovered).toMatchObject({
        status: 'ok',
        operation: { _tag: 'Whole', state: { _tag: 'Settled', execution: admitted, stop: receipt } },
      });
      expect(recovered instanceof ToolAnswer ? recovered.text : '').toContain('child still holds its pipe');
      expect(recovered instanceof ToolAnswer ? recovered.text : '').toContain('callback owner did not answer');
    }),
  );

  it.effect('a stop refused by stale authority sends nothing', () =>
    Effect.gen(function* () {
      const { store, projectId } = yield* Fixture;
      const admitted = execution('exec-command-stop-stale');
      const host = hostThat({ start: acceptedAs(admitted), stop: () => Effect.succeed(receiptFor(admitted)) });
      const floor = yield* floorOver(host);
      const { actor, prepared } = yield* launched(floor, 'op-command-stop-stale');
      const stopping = yield* stopOf(floor, 'op-command-stop-stale-stop', actor, `thread:${holder}`, prepared.targetKey, admitted);
      const placed = (at: number) => store.db.update(threadRecord()).set({ projectId: at }).where(eq(threadRecord().id, holder));
      const elsewhere = yield* store.db
        .insert(projectRow())
        .values({
          name: 'elsewhere',
          repoKey: 'elsewhere-key',
          rootPath: '/elsewhere',
          createdAt: new Date(yield* Clock.currentTimeMillis),
        })
        .returning({ id: projectRow().id });
      yield* placed(elsewhere[0]?.id ?? 0);
      yield* Effect.gen(function* () {
        expect(refusedReason(yield* Effect.result(stopping))).toBe('stale-authority');
        expect(host.asked()['stop']).toBeUndefined();
      }).pipe(Effect.ensuring(Effect.orDie(placed(projectId))));
    }),
  );

  it.effect('a retaken stop key refuses instead of stopping twice', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-stop-twice');
      const host = hostThat({ start: acceptedAs(admitted), stop: () => Effect.succeed(receiptFor(admitted)) });
      const floor = yield* floorOver(host);
      const { actor, prepared } = yield* launched(floor, 'op-command-stop-twice');
      yield* yield* stopOf(floor, 'op-command-stop-twice-stop', actor, `thread:${holder}`, prepared.targetKey, admitted);
      const again = yield* Effect.result(
        yield* stopOf(floor, 'op-command-stop-twice-stop', actor, `thread:${holder}`, prepared.targetKey, admitted),
      );
      expect(refusedReason(again)).toBe('operation-conflict');
      expect(host.asked()['stop']).toBe(1);
    }),
  );

  it.effect('a revision shortens over the revision it was prepared over, and a stale one answers Stale', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-revise');
      let expected = -1;
      const host = hostThat({
        start: acceptedAs(admitted),
        command: () => Effect.succeed(snapshotOf(projectId, admitted)),
        revise: (request) => {
          expected = request.expected;
          return Effect.succeed({
            _tag: 'Revised',
            operation: { installation, operation: HostRequestKey.make('op-command-revise') },
            deadline: { execution: admitted, revision: 3, executionMs: 30, ceilingMs: 100, origin: 'caller' },
          });
        },
      });
      const floor = yield* floorOver(host);
      const { actor, prepared } = yield* launched(floor, 'op-command-revise');
      const reason = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)('shorten for test');
      const revise = asRevise(
        yield* floor.access.prepare({
          _tag: 'Revise',
          actor,
          scope: projectId,
          execution: admitted,
          change: { _tag: 'Total', executionMs: 30 },
        }),
      );
      const limitKey = {
        projectId,
        operationId: HostRequestKey.make('op-command-revise-op'),
        requester: Principal.make(`thread:${holder}`),
        mutation: 'limit' as const,
        targetKey: prepared.targetKey,
        execution: admitted,
      };
      const authority = { prepared: revise, recheck: (unit: Unit<'machine'>) => floor.access.recheck(unit, revise) };
      expect((yield* floor.terminals.commands.revise(limitKey, admitted, authority, reason, revise.revision))._tag).toBe('Revised');
      expect(expected).toBe(2);
      expect(host.asked()['revise']).toBe(1);
      expect(yield* operationState('op-command-revise-op')).toMatchObject({ _tag: 'Settled' });
      const again = yield* Effect.result(floor.terminals.commands.revise(limitKey, admitted, authority, reason, revise.revision));
      expect(refusedReason(again)).toBe('operation-conflict');
      expect(host.asked()['revise']).toBe(1);

      const moved = execution('exec-command-revise-stale');
      const staleFloor = yield* floorOver(
        hostThat({
          start: acceptedAs(moved),
          command: () => Effect.succeed(snapshotOf(projectId, moved)),
          revise: (request) =>
            Effect.succeed({
              _tag: 'Stale',
              operation: { installation, operation: HostRequestKey.make('op-command-revise-stale-op') },
              deadline: { execution: moved, revision: request.expected + 1, executionMs: 40, ceilingMs: 100, origin: 'caller' },
            }),
        }),
      );
      const { prepared: stalePrepared } = yield* launched(staleFloor, 'op-command-revise-stale');
      const staleRevise = asRevise(
        yield* staleFloor.access.prepare({
          _tag: 'Revise',
          actor,
          scope: projectId,
          execution: moved,
          change: { _tag: 'Total', executionMs: 30 },
        }),
      );
      const staleOutcome = yield* staleFloor.terminals.commands.revise(
        {
          projectId,
          operationId: HostRequestKey.make('op-command-revise-stale-op'),
          requester: Principal.make(`thread:${holder}`),
          mutation: 'limit',
          targetKey: stalePrepared.targetKey,
          execution: moved,
        },
        moved,
        { prepared: staleRevise, recheck: (unit) => staleFloor.access.recheck(unit, staleRevise) },
        reason,
        staleRevise.revision,
      );
      expect(staleOutcome._tag).toBe('Stale');
    }),
  );

  it.effect('a wait answers the ending and a read answers the window, both bound to the prepared execution', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-observe');
      const host = hostThat({
        start: acceptedAs(admitted),
        state: () => Effect.succeed(summaryOf(endedState(admitted))),
        read: () =>
          Effect.succeed({
            range: {
              cursor: { ref: admitted, stream: 'stdout', offset: ByteOffset.make('0') },
              next: ByteOffset.make('5'),
              retainedFrom: ByteOffset.make('0'),
              durableThrough: ByteOffset.make('5'),
              gap: false,
            },
            bytes: new TextEncoder().encode('hello'),
            modes: PIPE_MODES,
          }),
      });
      const floor = yield* floorOver(host);
      const { actor } = yield* launched(floor, 'op-command-observe');
      const waiting = asAwait(yield* floor.access.prepare({ _tag: 'Await', actor, scope: projectId, execution: admitted }));
      const waitAuthority = { prepared: waiting, recheck: (unit: Unit<'machine'>) => floor.access.recheck(unit, waiting) };
      expect((yield* floor.terminals.commands.wait(admitted, waitAuthority, 1000))._tag).toBe('Decided');
      const observed = asObserve(yield* floor.access.prepare({ _tag: 'Observe', actor, scope: projectId, execution: admitted }));
      const window = yield* floor.terminals.commands.bytes({ ref: admitted, stream: 'stdout', offset: ByteOffset.make('0') }, 4096, {
        prepared: observed,
        recheck: (unit) => floor.access.recheck(unit, observed),
      });
      expect(new TextDecoder().decode(window.bytes)).toBe('hello');
      const stranger = yield* Effect.result(floor.terminals.commands.wait(execution('exec-command-stranger'), waitAuthority, 10));
      expect(refusedReason(stranger)).toBe('stale-authority');
    }),
  );

  it.effect('an ended command discharges through its own ending, keeping attribution', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-ended');
      const floor = yield* floorOver(hostThat({ start: acceptedAs(admitted), ending: () => Effect.succeed(endingOf(admitted)) }));
      yield* launched(floor, 'op-command-ended');
      expect(yield* floor.terminals.ended(projectId, admitted)).toEqual({ _tag: 'Discharged' });
      expect((yield* commandRow('exec-command-ended'))?.owner).toEqual(holderOwner);
      expect(yield* heldBy('op-command-ended')).toEqual([]);
    }),
  );

  it.effect('an admitted command retains what it is for, the line it ran, the program and the resolved cwd', () =>
    Effect.gen(function* () {
      const { resolved } = yield* Fixture;
      const floor = yield* floorOver(hostThat({ start: acceptedAs(execution('exec-command-picked')) }));
      const { receipt } = yield* launched(floor, 'op-command-picked', undefined, 'Typecheck the tree');
      if (receipt._tag !== 'Accepted') return yield* Effect.die(`the start answered ${receipt._tag}`);
      expect(receipt.record).toMatchObject({
        label: 'Typecheck the tree',
        commandLine: 'true',
        program: '/bin/sh',
        cwd: targetCwd(resolved),
      });
      expect(yield* commandRow('exec-command-picked')).toEqual(receipt.record);
    }),
  );

  it.effect('a command admitted before these facts were retained reads neither, and says so', () =>
    Effect.gen(function* () {
      const { units, terminalStore, projectId } = yield* Fixture;
      const admitted = execution('exec-command-unretained');
      const key = {
        projectId,
        operationId: HostRequestKey.make('op-command-unretained'),
        requester: Principal.make('operator'),
        mutation: 'start' as const,
        targetKey: TargetKey.make('target-unretained'),
      };
      yield* units.write('commandAdmission', (unit) =>
        Effect.gen(function* () {
          yield* terminalStore.intents.fence(
            unit,
            { key, phase: 'reserved', holdings: {}, openedAt: yield* Clock.currentTimeMillis },
            { createdBy: Principal.make('operator'), policyIdentity: 'policy-unretained', wait: 'foreground' },
          );
          return yield* terminalStore.commandRows.admitCommand(unit, key, admitted);
        }),
      );
      const row = yield* commandRow('exec-command-unretained');
      expect(row).toMatchObject({ policyIdentity: 'policy-unretained' });
      expect(row?.label).toBeUndefined();
      expect(row?.commandLine).toBeUndefined();
      expect(row?.program).toBeUndefined();
      expect(row?.cwd).toBeUndefined();
    }),
  );

  it.effect('admitting a command without its intent fails instead of inventing origin', () =>
    Effect.gen(function* () {
      const { units, terminalStore, projectId } = yield* Fixture;
      const outcome = yield* Effect.result(
        units.write('commandAdmission.outcome', (unit) =>
          terminalStore.commandRows.admitCommand(
            unit,
            {
              projectId,
              operationId: HostRequestKey.make('op-command-absent'),
              requester: Principal.make('operator'),
              mutation: 'start',
              targetKey: TargetKey.make('target-absent'),
            },
            execution('exec-command-absent'),
          ),
        ),
      );
      expect(outcome._tag === 'Failure' ? outcome.failure._tag : outcome._tag).toBe('TerminalUnavailable');
    }),
  );

  it.effect('a command cancelled before any spawn keeps no key, no origin and no reservation', () =>
    Effect.gen(function* () {
      const floor = yield* floorOver(hostThat({ start: (operation) => Effect.succeed({ _tag: 'Cancelled', operation }) }));
      const { receipt } = yield* launched(floor, 'op-command-cancelled');
      expect(receipt._tag === 'Refused' ? receipt.refusal.reason : receipt._tag).toBe('stale');
      expect(yield* operationState('op-command-cancelled')).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf('op-command-cancelled')).toBeNull();
      expect(yield* heldBy('op-command-cancelled')).toEqual([]);
      expect(yield* commandRow('exec-command-cancelled')).toBeNull();
    }),
  );

  it.effect('an obligation opens with the acceptance, ends when the ending is proved, and a mode moved after it is answered as ended', () =>
    Effect.gen(function* () {
      const { projectId, units, terminalStore } = yield* Fixture;
      const admitted = execution('exec-command-obligation');
      const floor = yield* floorOver(hostThat({ start: acceptedAs(admitted), ending: () => Effect.succeed(endingOf(admitted)) }));
      yield* launched(floor, 'op-command-obligation');
      expect(yield* waitOf(admitted)).toEqual({ execution: admitted, mode: 'foreground', revision: 0 });
      expect(yield* floor.terminals.ended(projectId, admitted)).toEqual({ _tag: 'Discharged' });
      expect(yield* waitOf(admitted)).toBeNull();
      expect((yield* commandRow('exec-command-obligation'))?.owner).toEqual(holderOwner);
      expect(
        yield* units.write('commandAdmission.late', (unit) => terminalStore.deliveries.moveCommandWait(unit, admitted, 0, 'background')),
      ).toEqual({ _tag: 'Ended' });
    }),
  );

  it.effect('a mode moves over the revision it was read at, and a mover that read an older one is answered with what stands', () =>
    Effect.gen(function* () {
      const { units, terminalStore } = yield* Fixture;
      const admitted = execution('exec-command-mode');
      const floor = yield* floorOver(hostThat({ start: acceptedAs(admitted) }));
      yield* launched(floor, 'op-command-mode');
      expect(
        yield* units.write('commandAdmission.moved', (unit) => terminalStore.deliveries.moveCommandWait(unit, admitted, 0, 'background')),
      ).toEqual({ _tag: 'Moved', wait: { execution: admitted, mode: 'background', revision: 1 } });
      expect(
        yield* units.write('commandAdmission.stale', (unit) => terminalStore.deliveries.moveCommandWait(unit, admitted, 0, 'foreground')),
      ).toEqual({ _tag: 'Stale', wait: { execution: admitted, mode: 'background', revision: 1 } });
      expect(yield* waitOf(admitted)).toEqual({ execution: admitted, mode: 'background', revision: 1 });
    }),
  );

  it.effect('an owner-wide stop fences the owner, ends what it still holds and names what it cannot place', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const first = execution('exec-sweep-1');
      const second = execution('exec-sweep-2');
      const accepted: Record<string, ExecutionRef> = { 'op-sweep-1': first, 'op-sweep-2': second };
      const host = hostThat({
        start: (operation) => {
          const ref = accepted[operation.operation];
          return ref === undefined
            ? new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true })
            : acceptedAs(ref)(operation);
        },
        stop: (ref) => Effect.succeed(receiptFor(ref)),
      });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf(swept);
      const owner: CommandSubject = { _tag: 'Thread', thread: swept };
      for (const operationId of ['op-sweep-1', 'op-sweep-2', 'op-sweep-lost']) {
        yield* attempted(floor, operationId, actor, owner, creatorOf(swept));
      }
      const { key, authorize } = yield* sweepOf(floor, 'op-sweep-all', swept, actor, owner);
      const sweep = yield* floor.terminals.commands.stopAll(projectId, [owner], key, authorize, 'explicit-stop', 'signal');
      expect(sweep.fences).toEqual([1]);
      expect(sweep.stopped.map((receipt) => receipt.execution.execution).sort()).toEqual([first.execution, second.execution].sort());
      expect(sweep.refused).toEqual([]);
      expect(sweep.standing).toEqual([]);
      expect(sweep.unresolved.map((entry) => entry.operationId)).toEqual([HostRequestKey.make('op-sweep-lost')]);
      expect(host.asked()['stop']).toBe(2);
      expect(yield* waitOf(first)).toBeNull();
      expect(yield* waitOf(second)).toBeNull();
      expect(yield* heldBy('op-sweep-1')).toEqual([]);
      expect(yield* fenceOf(owner)).toBe(1);
    }),
  );

  it.effect('a launch prepared before its owner was fenced refuses before any spawn', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const host = hostThat({ start: acceptedAs(execution('exec-fenced')) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf(fenced);
      const owner: CommandSubject = { _tag: 'Thread', thread: fenced };
      const prepared = yield* launchOf(floor.access, 'op-fenced-launch', actor, owner, creatorOf(fenced));
      const { key } = yield* sweepOf(floor, 'op-fenced-sweep', fenced, actor, owner);
      const sweep = yield* floor.terminals.commands.stopAll(
        projectId,
        [owner],
        key,
        () => Effect.die('this owner holds nothing, so nothing is authorized to be stopped'),
        'explicit-stop',
        'signal',
      );
      expect(sweep.stopped).toEqual([]);
      expect(sweep.fences).toEqual([1]);
      const failed = yield* Effect.result(
        Effect.scoped(floor.terminals.start(yield* startOf('op-fenced-launch', actor, prepared, floor.access))),
      );
      expect(refusedReason(failed)).toBe('stale-authority');
      expect(host.asked()['start']).toBeUndefined();
      expect(yield* operationState('op-fenced-launch')).toMatchObject({ _tag: 'Unknown' });
      expect(yield* heldBy('op-fenced-launch')).toEqual([]);
    }),
  );

  it.effect('owners rebuilt over the same store read the same command identity back, without a second launch', () =>
    Effect.gen(function* () {
      const { store } = yield* Fixture;
      const admitted = execution('exec-command-restart');
      const host = hostThat({ start: acceptedAs(admitted) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const prepared = yield* launchOf(floor.access, 'op-command-restart', actor, holderOwner, creatorOf(holder));
      const request = yield* startOf('op-command-restart', actor, prepared, floor.access);
      const first = yield* Effect.scoped(floor.terminals.start(request));
      if (first._tag !== 'Accepted') return yield* Effect.die(`the start answered ${first._tag}`);
      const { terminals: owners } = yield* guardedFloor({ port: host.port, guarded: host.port, db: store.db, installation });
      const again = yield* Effect.scoped(owners.start(request));
      expect(again._tag === 'Accepted' ? again.record : again._tag).toEqual(first.record);
      expect(yield* owners.commands.record(admitted.execution, admitted.incarnation)).toEqual(first.record);
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect('the product port forwards a prepared command launch, and refuses one nothing prepared', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-port-command');
      const host = hostThat({ start: acceptedAs(admitted), state: () => Effect.succeed(summaryOf(commandState(admitted))) });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf();
      const caller = { actor, projectId, kind: 'host' as const, root: checkout };
      const admit = admitCommands((operation, target, launch) =>
        Effect.map(
          floor.access.prepare({
            _tag: 'Launch',
            actor,
            scope: projectId,
            target,
            program: launch.command.program,
            args: launch.command.args,
            tool: 'bash',
            owner: holderOwner,
            creator: creatorOf(holder),
            operation: operation.operation,
          }),
          (act) => ({ prepared: asLaunch(act), recheck: (unit: Unit<'machine'>) => floor.access.recheck(unit, act) }),
        ),
      );
      const scope = yield* Effect.scope;
      const portOver = (admitting?: typeof admit) =>
        terminalExecutions({
          terminals: floor.terminals,
          writing: floor.terminals,
          evidence: floor.terminals,
          discharge: floor.terminals,
          host: hostConnection({ installation, state: 'test-state' }, host.port),
          caller,
          scope,
          admit: admitting,
        });
      const outcome = yield* portOver(admit).start(
        { installation, operation: HostRequestKey.make('op-port-command') },
        commandLaunchOf(projectId),
      );
      expect(outcome._tag === 'Accepted' ? outcome.execution.execution : outcome._tag).toBe(admitted.execution);
      expect((yield* commandRow('exec-port-command'))?.owner).toEqual(holderOwner);
      const refused = yield* Effect.result(
        portOver().start({ installation, operation: HostRequestKey.make('op-port-unprepared') }, commandLaunchOf(projectId)),
      );
      expect(refused._tag === 'Failure' && refused.failure._tag === 'HostRefused' ? refused.failure.refusal._tag : refused._tag).toBe(
        'Unauthorized',
      );
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect('a git command runs as an admitted command and answers git’s own status and both streams', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-git-spoke');
      const host = consoleHost(
        admitted,
        { stdout: 'M  src/a.ts\n', stderr: 'warning: CRLF\n' },
        {
          exit: { _tag: 'Code', code: 1 },
          decision: {
            _tag: 'Completed',
            operation: { installation, operation: HostRequestKey.make('op-git-spoke/1') },
            execution: admitted,
            sequence: 0,
          },
        },
      );
      const answer = yield* gitRun(host, 'op-git-spoke', ['-C', checkout, 'status', '--porcelain']);
      expect(answer.status).toBe(1);
      expect(answer.stdout).toContain('M  src/a.ts');
      expect(answer.stderr).toContain('CRLF');
      expect(answer.overflow).toBe(false);
      expect(host.asked()['start']).toBeDefined();
    }),
  );

  it.effect(
    'a git command’s console arrives whole across the host’s windows up to the end its ending names, and past the kept bytes it says so',
    () =>
      Effect.gen(function* () {
        const windowed = (said: { readonly stdout: string; readonly stderr: string }) => (cursor: ByteCursor, limit: number) =>
          Effect.map(consoleOf(said)(cursor), (whole) => {
            const bytes = whole.bytes.slice(0, Math.min(1000, limit));
            const next = ByteOffset.make(String(Number(cursor.offset) + bytes.length));
            return { ...whole, range: { ...whole.range, next }, bytes };
          });
        const answered = (id: string, said: { readonly stdout: string; readonly stderr: string }) =>
          gitRun(consoleHost(execution(id), said, { exit: { _tag: 'Code', code: 0 } }, windowed(said)), `op-${id}`, [
            '-C',
            checkout,
            'diff',
          ]);
        const long = 'x'.repeat(2500);
        expect(yield* answered('exec-git-windows', { stdout: long, stderr: '' })).toMatchObject({
          stdout: long,
          stderr: '',
          overflow: false,
          messageOverflow: false,
        });
        expect(yield* answered('exec-git-cut', { stdout: 'y'.repeat(5000), stderr: '' })).toMatchObject({
          stdout: 'y'.repeat(4096),
          overflow: true,
        });
      }),
  );

  it.effect('one git act survives unrelated registration and refuses a new overlapping root', () =>
    Effect.gen(function* () {
      const { units, rootUses, fileRoots } = yield* Fixture;
      let admitted = execution('exec-git-scope-first');
      const host = hostThat({
        start: (operation) => acceptedAs(admitted)(operation),
        state: () => Effect.succeed(endedSummary(admitted, { exit: { _tag: 'Code', code: 0 } })),
        read: consoleOf({ stdout: '', stderr: '' }),
      });
      const git = yield* gitOver(yield* floorOver(host), 'op-git-scope');
      expect((yield* git.run(['status'])).status).toBe(0);
      const unrelated = join(home, 'git-scope-unrelated');
      mkdirSync(unrelated);
      yield* fileRoots.register({ path: unrelated, provenance: { kind: 'test', id: 'unrelated' } });
      admitted = execution('exec-git-scope-second');
      expect((yield* git.run(['status'])).status).toBe(0);
      const overlap = yield* fileRoots.register({ path: join(checkout, 'src'), provenance: { kind: 'test', id: 'overlap' } });
      yield* Effect.gen(function* () {
        expect((yield* Effect.flip(git.run(['status'])))._tag).toBe('GitUnavailable');
      }).pipe(Effect.ensuring(Effect.orDie(units.write('test.retire', (unit) => rootUses.forget(unit, null, overlap)))));
    }),
  );

  it.effect(
    'submit_work’s git is admitted under the default where the host offers the command road, and runs on the platform where it does not',
    () =>
      Effect.gen(function* () {
        const { projectId } = yield* Fixture;
        const admitted = execution('exec-git-served');
        const launches: LaunchRequest[] = [];
        const offering = (transports: readonly string[]) =>
          hostThat({
            capabilities: () => Effect.succeed({ transports } as unknown as CapabilityProfile),
            start: (operation, launch) => {
              launches.push(launch);
              return acceptedAs(admitted)(operation);
            },
            state: () =>
              Effect.succeed(
                endedSummary(admitted, {
                  exit: { _tag: 'Code', code: 0 },
                  decision: {
                    _tag: 'Completed',
                    operation: { installation, operation: HostRequestKey.make('op-git-served/1') },
                    execution: admitted,
                    sequence: 0,
                  },
                }),
              ),
            read: consoleOf({ stdout: 'admitted', stderr: '' }),
          });
        const act = { projectId, thread: holder, root: checkout };

        const platform = platformGit();
        const served = yield* (yield* gitOf(yield* floorOver(offering(['pipes'])))).run(act, platform.faces);
        expect((yield* served.run(['-C', checkout, 'status'])).stdout).toContain('admitted');
        expect(platform.calls).toEqual([]);
        expect(launches).toHaveLength(1);
        const launch = launches[0];
        expect(launch?.lifetime === 'command' ? launch.admission.limits : undefined).toEqual({
          executionMs: 3_600_000,
          executionCeilingMs: 21_600_000,
          origin: 'default',
        });
        expect(launch?.command.environment).toContainEqual({ name: OWN_GIT_VARIABLE, value: '1' });

        const bare = offering([]);
        const local = platformGit();
        const unserved = yield* (yield* gitOf(yield* floorOver(bare))).run(act, local.faces);
        expect((yield* unserved.run(['-C', checkout, 'status'])).stdout).toBe('platform');
        expect(bare.asked()['start']).toBeUndefined();
      }),
  );

  it.effect('a cancelled git command is never read as a status', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-git-cancelled');
      const host = consoleHost(
        admitted,
        { stdout: '', stderr: '' },
        {
          exit: { _tag: 'Code', code: 0 },
          decision: {
            _tag: 'Cancelled',
            operation: { installation, operation: HostRequestKey.make('op-git-cancelled/1') },
            execution: admitted,
            sequence: 0,
            cause: 'timeout',
            trigger: 'the execution budget',
          },
        },
      );
      expect((yield* Effect.flip(gitRun(host, 'op-git-cancelled', ['-C', checkout, 'rev-parse', 'HEAD'])))._tag).toBe(
        'GitEndingUnreadable',
      );
    }),
  );

  it.effect('a git command that writes to its own input is never started without it', () =>
    Effect.gen(function* () {
      const host = consoleHost(execution('exec-git-stdin'), { stdout: '', stderr: '' }, { exit: { _tag: 'Code', code: 0 } });
      const git = yield* gitOver(yield* floorOver(host), 'op-git-stdin');
      const failure = yield* Effect.flip(
        git.run(['-C', checkout, 'update-index', '-z', '--index-info'], {
          stdin: '100644 0000000000000000000000000000000000000000\0src/a.ts\0',
        }),
      );
      expect(failure._tag).toBe('GitUnavailable');
      expect(host.asked()['start']).toBeUndefined();
    }),
  );

  it.effect(
    'a git command the admission refuses is not admitted, with the admission’s own code and way out, and the host is never asked',
    () =>
      Effect.gen(function* () {
        const host = hostThat({});
        const failure = yield* Effect.flip(
          gitRun(host, 'op-git-no-owner', ['-C', checkout, 'rev-parse', 'HEAD'], ThreadId.make('thread-git-nobody')),
        );
        if (!(failure instanceof GitNotAdmitted)) return yield* Effect.die(`git answered ${failure._tag}`);
        expect(failure.code).toBe('terminal-unrelated');
        expect(failure.unblock.length).toBeGreaterThan(0);
        expect(host.asked()['start']).toBeUndefined();
      }),
  );

  it.effect('a host that cannot start a git command leaves git unavailable, not refused', () =>
    Effect.gen(function* () {
      const host = hostThat({ start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the host did not answer', sent: false }) });
      expect((yield* Effect.flip(gitRun(host, 'op-git-host-down', ['-C', checkout, 'rev-parse', 'HEAD'])))._tag).toBe('GitUnavailable');
    }),
  );

  it.effect('the native byte read keeps the stdout and stderr of an ended command at the requested offset', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-native-bytes');
      const host = consoleHost(admitted, { stdout: 'hello', stderr: 'warning' }, { exit: { _tag: 'Code', code: 0 } });
      yield* launched(yield* floorOver(host), 'op-command-native-bytes', 'background');
      type Bytes = { status: string; bytes: string; range: { next: string; gap: boolean } };
      const read = Effect.fnUntraced(function* (stream: 'stdout' | 'stderr', offset: string) {
        return (yield* walked((yield* catalogOver(host)).read_command_bytes as Tool, {
          execution: admitted.execution,
          incarnation: admitted.incarnation,
          stream,
          offset,
        })) as Bytes;
      });
      const stdout = yield* read('stdout', '1');
      const stderr = yield* read('stderr', '0');
      const operation = (yield* walked((yield* catalogOver(host)).read_terminal_operation as Tool, {
        operationId: 'op-command-native-bytes',
      })) as { operation: { _tag: string; state?: { _tag: string; execution?: ExecutionRef } } };
      expect(operation.operation._tag).toBe('Whole');
      expect(operation.operation.state?.execution).toEqual(admitted);
      expect(stdout.status).toBe('ok');
      expect(Buffer.from(stdout.bytes, 'base64').toString()).toBe('ello');
      expect(stdout.range.next).toBe('5');
      expect(stderr.status).toBe('ok');
      expect(Buffer.from(stderr.bytes, 'base64').toString()).toBe('warning');
      expect(stderr.range.gap).toBe(false);
    }),
  );

  it.effect('a word that is not an owner key refuses on the native listing rather than answering empty', () =>
    Effect.gen(function* () {
      const answer = yield* walk((yield* catalogOver(hostThat({}))).read_commands as Tool, { owner: 'not-an-owner', limit: 1 });
      if (!(answer instanceof ToolAnswer)) return yield* Effect.die('the native listing returned no typed refusal');
      expect(answer.verdict).toMatchObject({ kind: 'refused', refusal: { code: 'terminal-no-owner' } });
      expect(answer.value).toMatchObject({ status: 'refused', code: 'terminal-no-owner' });
    }),
  );

  it.effect('the native listing answers the end of the admission order the caller named', () =>
    Effect.gen(function* () {
      const ordered = ThreadId.make('thread-command-ordered');
      yield* threadRow(ordered);
      const actor = yield* actorOf(ordered);
      for (const at of ['first', 'second'] as const) {
        const floor = yield* floorOver(hostThat({ start: acceptedAs(execution(`exec-order-${at}`)) }));
        const outcome = yield* attempted(
          floor,
          `op-command-order-${at}`,
          actor,
          { _tag: 'Thread', thread: ordered },
          creatorOf(ordered),
          'background',
        );
        expect(outcome._tag === 'Success' ? outcome.success._tag : outcome._tag).toBe('Accepted');
      }
      const named = Effect.fnUntraced(function* (order: 'oldest' | 'newest') {
        const answer = (yield* walked((yield* catalogOver(hostThat({}), ordered)).read_commands as Tool, {
          owner: `thread:${ordered}`,
          order,
          limit: 1,
        })) as { status: string; readings: readonly { readonly command: { readonly execution: { readonly execution: string } } }[] };
        expect(answer.status).toBe('ok');
        return answer.readings.map((reading) => reading.command.execution.execution);
      });
      expect(yield* named('oldest')).toEqual(['exec-order-first']);
      expect(yield* named('newest')).toEqual(['exec-order-second']);
    }),
  );

  it.effect('read_output answers the tail on a first look, then only what arrived since this reader last looked', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-output');
      const encoder = new TextEncoder();
      const record = { stdout: encoder.encode('one\ntwo\n'), stderr: new Uint8Array(0) };
      const positionsOf = (stream: 'stdout' | 'stderr') => ({
        stream,
        retainedFrom: ByteOffset.make('0'),
        durableThrough: ByteOffset.make(String(record[stream].length)),
        parsedThrough: ByteOffset.make('0'),
        ending: 'open' as const,
      });
      const running = { ...commandState(admitted), phase: 'running' as const };
      const host = hostThat({
        start: acceptedAs(admitted),
        state: () => Effect.succeed(summaryOf(running, [positionsOf('stdout'), positionsOf('stderr')])),
        status: statusOf(admitted),
        commandsAt: batchOf(projectId, admitted, running, 12_000),
        read: (cursor, limit) =>
          Effect.sync(() => {
            const buffer = record[cursor.stream === 'stderr' ? 'stderr' : 'stdout'];
            const from = Number(cursor.offset);
            const to = Math.min(buffer.length, from + limit);
            return {
              range: {
                cursor,
                next: ByteOffset.make(String(to)),
                retainedFrom: ByteOffset.make('0'),
                durableThrough: ByteOffset.make(String(buffer.length)),
                gap: false,
              },
              bytes: buffer.subarray(from, to),
              modes: PIPE_MODES,
            };
          }),
      });
      const floor = yield* floorOver(host);
      expect((yield* launched(floor, 'op-command-output', 'background')).receipt._tag).toBe('Accepted');
      const catalog = yield* catalogOver(host, holder, floor);
      expect(yield* outputOf(catalog, admitted)).toMatchObject({
        status: 'ok',
        phase: 'running',
        elapsedMs: 12_000,
        output: 'one\ntwo\n',
        first: true,
        skippedBytes: 0,
      });
      expect(yield* outputOf(catalog, admitted)).toMatchObject({ status: 'ok', output: '', first: false });

      record.stdout = encoder.encode('one\ntwo\nthree\n');
      record.stderr = encoder.encode('warned\n');
      expect(yield* outputOf(catalog, admitted)).toMatchObject({ status: 'ok', output: 'three\n\nwarned\n', first: false });

      record.stdout = encoder.encode('one\ntwo\nthree\nfour\nfive\n');
      expect(yield* outputOf(catalog, admitted, { tail: 1 })).toMatchObject({ status: 'ok', output: 'five\n' });
      expect(yield* outputOf(catalog, admitted)).toMatchObject({ status: 'ok', output: '' });

      const another = ThreadId.make('thread-command-another-reader');
      yield* threadRow(another);
      expect(yield* outputOf(yield* catalogOver(host, another, floor), admitted)).toMatchObject({
        status: 'ok',
        first: true,
        output: 'one\ntwo\nthree\nfour\nfive\n\nwarned\n',
      });
    }),
  );

  it.effect('read_output returns the true test summary across sealed segments, preserving UTF-8 and consuming the selected tail', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const fs = yield* FileSystem.FileSystem;
      const encoder = new TextEncoder();
      const segmentBytes = 32 * 1024;
      for (const [total, code, tail] of [
        [3 * segmentBytes + 480, 0, 40],
        [3 * segmentBytes + 8192, 1, 45],
      ] as const) {
        const admitted = execution(`exec-sealed-output-${code}`);
        const summary = `\n4023 tests, 522 suites, ${code === 0 ? 0 : 3} issues\n`;
        const stdout = new Uint8Array(total).fill(120);
        stdout.set(encoder.encode('é'), 3 * segmentBytes - 1);
        stdout.set(encoder.encode(summary), total - encoder.encode(summary).length);
        const stderr = encoder.encode('stderr complete\n');
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'command-output-' });
        const streams = yield* Effect.forEach(['stdout', 'stderr'] as const, (stream) =>
          Effect.gen(function* () {
            const buffer = stream === 'stdout' ? stdout : stderr;
            yield* fs.makeDirectory(join(directory, stream));
            const segments = [];
            for (let first = 0; first < buffer.length; first += segmentBytes) {
              const payload = buffer.subarray(first, first + segmentBytes);
              const header = encodeSegmentHeader(stream, BigInt(first));
              if ('defect' in header) return yield* Effect.die(header.detail);
              const bytes = new Uint8Array(header.length + payload.length);
              bytes.set(header);
              bytes.set(payload, header.length);
              yield* fs.writeFile(join(directory, stream, segmentFile(BigInt(first))), bytes);
              segments.push({
                first: byteOffset(BigInt(first)),
                end: byteOffset(BigInt(first + payload.length)),
                checksum: crc32Final(crc32Update(CRC32_INITIAL, payload)),
              });
            }
            return {
              positions: {
                stream,
                retainedFrom: ByteOffset.make('0'),
                durableThrough: byteOffset(BigInt(buffer.length)),
                parsedThrough: ByteOffset.make('0'),
                ending: 'eof' as const,
              },
              tail: 'complete' as const,
              segments,
            };
          }),
        );
        const record = yield* makeSealedRecord({ directory, seal: { ref: admitted, transport: 'pipes', streams } });
        const ended = endedState(admitted, { _tag: 'Code', code });
        const host = hostThat({
          start: acceptedAs(admitted),
          state: () =>
            Effect.succeed(
              summaryOf(
                ended,
                streams.map((stream) => stream.positions),
              ),
            ),
          status: statusOf(admitted),
          commandsAt: batchOf(projectId, admitted, ended, 3_000),
          ending: () => Effect.succeed(endingOf(admitted)),
          read: (cursor, limit) =>
            record.read(cursor, limit).pipe(
              Effect.map((chunk) => ({ ...chunk, modes: PIPE_MODES })),
              Effect.orDie,
            ),
        });
        const floor = yield* floorOver(host);
        expect((yield* launched(floor, `op-sealed-output-${code}`, 'background')).receipt._tag).toBe('Accepted');
        const catalog = yield* catalogOver(host, holder, floor);
        yield* (yield* waitersFor()).measured(admitted, '');
        const notices: string[] = [];
        const delivery = yield* commandDelivery({
          send: asCommandSignalSend((input) =>
            Effect.sync(() => {
              notices.push(input.text);
              return { _tag: 'Accepted' } as const;
            }),
          ),
        }).pipe(
          Effect.provideService(CommandWaiters, yield* waitersFor()),
          Effect.provideService(Terminals, floor.terminals),
          Effect.provideService(ManagedCommands, floor.terminals.commands),
          Effect.provideService(ExecutionRecords, floor.terminals),
        );
        yield* delivery.deliver(admitted);
        expect(notices[0]).toContain(summary.trim());
        const expected = new TextDecoder().decode(stdout.subarray(total - 50 * 1024)) + '\n' + new TextDecoder().decode(stderr);
        expect(yield* outputOf(catalog, admitted, { tail, wait: code === 1 ? 60 : undefined })).toMatchObject({
          status: 'ok',
          phase: 'ended',
          exit: { _tag: 'Code', code },
          output: expected,
          first: true,
          skippedBytes: 0,
        });
        expect(yield* outputOf(catalog, admitted, { tail })).toMatchObject({ status: 'ok', output: '', first: false });
      }
    }).pipe(Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))),
  );

  it.effect('search_output finds diagnostics read_output no longer reaches, page by page across both streams, and consumes nothing', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-search');
      const encoder = new TextEncoder();
      const head = [
        'Compiling',
        'a.swift:3: note: here',
        "a.swift:4: error: cannot find 'x' in scope",
        'between',
        'a.swift:9: error: missing return',
      ];
      const filler = 'warning: deprecated API\n'.repeat(3_000);
      const record = {
        stdout: encoder.encode(`${head.join('\n')}\nafter\n${filler}Test run failed\n`),
        stderr: encoder.encode(`fatal error: build failed\n${'y'.repeat(2_000)} deep diagnostic\n`),
      };
      const ended = endedState(admitted, { _tag: 'Code', code: 1 });
      const positionsOf = (stream: 'stdout' | 'stderr') => ({
        stream,
        retainedFrom: ByteOffset.make('0'),
        durableThrough: ByteOffset.make(String(record[stream].length)),
        parsedThrough: ByteOffset.make('0'),
        ending: 'eof' as const,
      });
      const host = hostThat({
        start: acceptedAs(admitted),
        state: () => Effect.succeed(summaryOf(ended, [positionsOf('stdout'), positionsOf('stderr')])),
        status: statusOf(admitted),
        commandsAt: batchOf(projectId, admitted, ended, 3_000),
        ending: () => Effect.succeed(endingOf(admitted)),
        read: (cursor, limit) =>
          Effect.sync(() => {
            const buffer = record[cursor.stream === 'stderr' ? 'stderr' : 'stdout'];
            const from = Number(cursor.offset);
            const to = Math.min(buffer.length, from + limit, from + 65_536);
            return {
              range: {
                cursor,
                next: ByteOffset.make(String(to)),
                retainedFrom: ByteOffset.make('0'),
                durableThrough: ByteOffset.make(String(buffer.length)),
                gap: false,
              },
              bytes: buffer.subarray(from, to),
              modes: PIPE_MODES,
            };
          }),
      });
      const floor = yield* floorOver(host);
      expect((yield* launched(floor, 'op-command-search', 'background')).receipt._tag).toBe('Accepted');
      const catalog = yield* catalogOver(host, holder, floor);
      const search = (input: Record<string, unknown>) =>
        walked(catalog.search_output as Tool, { execution: admitted.execution, incarnation: admitted.incarnation, ...input });

      const first = yield* search({ pattern: 'error', before: 1, after: 2, limit: 1 });
      expect(first).toMatchObject({
        status: 'ok',
        phase: 'ended',
        total: 3,
        shown: 1,
        matches: [
          {
            stream: 'stdout',
            line: 3,
            offset: '32',
            before: [{ line: 2, text: 'a.swift:3: note: here' }],
            after: [{ line: 4, text: 'between' }],
          },
        ],
      });
      const second = yield* search({ pattern: 'error', before: 1, after: 2, limit: 1, cursor: (first as { next: string }).next });
      expect(second).toMatchObject({
        status: 'ok',
        total: 3,
        matches: [
          {
            stream: 'stdout',
            line: 5,
            text: 'a.swift:9: error: missing return',
            before: [],
            after: [
              { line: 6, text: 'after' },
              { line: 7, text: 'warning: deprecated API' },
            ],
          },
        ],
      });
      const third = yield* search({ pattern: 'error', before: 1, after: 2, limit: 1, cursor: (second as { next: string }).next });
      expect(third).toMatchObject({
        status: 'ok',
        next: null,
        matches: [{ stream: 'stderr', line: 1, text: 'fatal error: build failed', before: [], after: [{ line: 2 }] }],
      });
      const deep = (yield* search({ pattern: 'deep diagnostic', stream: 'stderr' })) as { matches: readonly { text: string }[] };
      expect(deep.matches[0]?.text.startsWith('…')).toBe(true);
      expect(deep.matches[0]?.text.endsWith('deep diagnostic')).toBe(true);
      expect(yield* search({ pattern: 'error', limit: 1, cursor: (first as { next: string }).next })).toMatchObject({
        status: 'refused',
        code: 'cursor-stale',
      });
      expect(yield* search({ pattern: '(' })).toMatchObject({ status: 'refused', code: 'search-failed' });
      expect(yield* outputOf(catalog, admitted)).toMatchObject({ status: 'ok', first: true });
    }),
  );

  it.effect('the thread that read its background command ended is owed no ending notice; another reader discharges nothing', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-read-ended');
      const ended = endedState(admitted, { _tag: 'Code', code: 0 });
      const host = hostThat({
        start: acceptedAs(admitted),
        state: () => Effect.succeed(summaryOf(ended)),
        status: statusOf(admitted),
        commandsAt: batchOf(projectId, admitted, ended, 3_000),
        read: (cursor) =>
          Effect.succeed({
            range: {
              cursor,
              next: ByteOffset.make('0'),
              retainedFrom: ByteOffset.make('0'),
              durableThrough: ByteOffset.make('0'),
              gap: false,
            },
            bytes: new Uint8Array(0),
            modes: PIPE_MODES,
          }),
      });
      const floor = yield* floorOver(host);
      expect((yield* launched(floor, 'op-command-read-ended', 'background')).receipt._tag).toBe('Accepted');
      yield* (yield* waitersFor()).measured(admitted, '');
      expect(yield* deliveryOf(admitted)).not.toBeNull();

      const bystander = ThreadId.make('thread-command-ended-bystander');
      yield* threadRow(bystander);
      expect(yield* outputOf(yield* catalogOver(host, bystander), admitted)).toMatchObject({ status: 'ok', phase: 'ended' });
      expect(yield* deliveryOf(admitted)).not.toBeNull();

      expect(yield* outputOf(yield* catalogOver(host), admitted)).toMatchObject({ status: 'ok', phase: 'ended' });
      expect(yield* deliveryOf(admitted)).toBeNull();

      const sent: string[] = [];
      const send: ReturnType<typeof asCommandSignalSend> = (input) =>
        Effect.sync(() => {
          sent.push(input.id);
          return { _tag: 'Accepted' } as const;
        });
      const endings = yield* Queue.unbounded<ExecutionRef>();
      const delivery = yield* commandDelivery({ send }).pipe(
        Effect.provideService(CommandWaiters, yield* waitersFor(endings)),
        Effect.provideService(Terminals, floor.terminals),
        Effect.provideService(ManagedCommands, floor.terminals.commands),
        Effect.provideService(ExecutionRecords, floor.terminals),
      );
      expect(yield* delivery.deliver(admitted)).toEqual({ _tag: 'Settled' });
      expect(sent).toEqual([]);
    }),
  );

  it.effect('read_output of an ended command whose kept output the host dropped says so and reads no bytes', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-evicted');
      const ended = endedState(admitted, { _tag: 'Code', code: 0 });
      let reads = 0;
      const host = hostThat({
        start: acceptedAs(admitted),
        state: () => Effect.succeed(summaryOf(ended)),
        status: statusOf(admitted),
        commandsAt: batchOf(projectId, admitted, ended, 1_000, {
          execution: admitted,
          nativeExit: { _tag: 'Code', code: 0 },
          cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'dropped' },
          coverage: [],
          relation: 'covered',
          confirmed: [],
          residual: [],
          unverifiable: [],
          streams: [],
          cleanup: 'complete',
          retention: 'lost',
          abandonedOutput: false,
        }),
        read: () =>
          Effect.sync(() => {
            reads += 1;
            return undefined as never;
          }),
      });
      expect((yield* launched(yield* floorOver(host), 'op-command-evicted', 'background')).receipt._tag).toBe('Accepted');
      expect(yield* outputOf(yield* catalogOver(host), admitted)).toMatchObject({
        status: 'ok',
        phase: 'ended',
        evicted: true,
        output: '',
      });
      expect(reads).toBe(0);
    }),
  );

  it.effect('a background command its own thread stopped is owed no ending notice; the operator stopping it leaves the notice owed', () =>
    Effect.gen(function* () {
      const stoppedBy = Effect.fnUntraced(function* (at: string, stopper: TerminalActor, requester: string) {
        const admitted = execution(`exec-command-stopped-by-${at}`);
        const floor = yield* floorOver(hostThat({ start: acceptedAs(admitted), stop: () => Effect.succeed(receiptFor(admitted)) }));
        const { prepared, receipt } = yield* launched(floor, `op-stopped-by-${at}`, 'background');
        expect(receipt._tag).toBe('Accepted');
        expect(yield* deliveryOf(admitted)).not.toBeNull();
        yield* yield* stopOf(floor, `op-stopped-by-${at}-stop`, stopper, requester, prepared.targetKey, admitted);
        return yield* deliveryOf(admitted);
      });
      expect(yield* stoppedBy('operator', { _tag: 'Operator' }, 'operator')).not.toBeNull();
      expect(yield* stoppedBy('its-thread', yield* actorOf(), `thread:${holder}`)).toBeNull();
    }),
  );

  it.effect('a notice cannot be accepted while its own thread is stopping the command, and a stop that fails hands it back', () =>
    Effect.gen(function* () {
      const { units } = yield* Fixture;
      const stopping = Effect.fnUntraced(function* (
        at: string,
        answer: (ref: ExecutionRef) => Effect.Effect<StopReceipt, ExecutionsFailure>,
      ) {
        const admitted = execution(`exec-command-stopping-${at}`);
        const inFlight = yield* Deferred.make<void>();
        const go = yield* Deferred.make<void>();
        const host = hostThat({
          start: acceptedAs(admitted),
          stop: () => Deferred.succeed(inFlight, undefined).pipe(Effect.andThen(Deferred.await(go)), Effect.andThen(answer(admitted))),
        });
        const handedBack = yield* Queue.unbounded<ExecutionRef>();
        const waiters = yield* waitersFor(handedBack);
        const floor = yield* floorOver(host, waiters);
        const { actor, prepared, receipt } = yield* launched(floor, `op-stopping-${at}`, 'background');
        expect(receipt._tag).toBe('Accepted');
        const stopped = yield* Effect.forkChild(
          Effect.result(yield* stopOf(floor, `op-stopping-${at}-stop`, actor, `thread:${holder}`, prepared.targetKey, admitted)),
        );
        yield* Deferred.await(inFlight);
        const acceptedMidStop = yield* units
          .write('commandAdmission.acceptedMidStop', (unit) => waiters.accepted(unit, admitted))
          .pipe(Effect.orDie);
        yield* Deferred.succeed(go, undefined);
        yield* Fiber.join(stopped);
        return {
          acceptedMidStop,
          owed: yield* deliveryOf(admitted),
          handedBack: Option.getOrUndefined(yield* Queue.poll(handedBack)),
          admitted,
        };
      });

      expect(yield* stopping('held', (ref) => Effect.succeed(receiptFor(ref)))).toMatchObject({
        acceptedMidStop: false,
        owed: null,
        handedBack: undefined,
      });

      const failed = yield* stopping(
        'failed',
        () => new WireUnavailable({ kind: 'unreachable', reason: 'the host did not answer', sent: false }),
      );
      expect(failed.acceptedMidStop).toBe(false);
      expect(failed.owed).not.toBeNull();
      expect(failed.handedBack).toEqual(failed.admitted);
    }),
  );

  it.effect('stop of a command this installation never admitted names no-command and never reaches the host', () =>
    Effect.gen(function* () {
      const host = hostThat({});
      const result = yield* Effect.result(
        walk((yield* catalogOver(host)).stop_command as Tool, {
          operationId: 'op-native-unknown',
          execution: 'never-started',
          incarnation: 1,
          cause: 'explicit-stop',
        }),
      );
      expect(result._tag === 'Failure' ? result.failure._tag : result._tag).toBe('Tool.Failed');
      expect(String(result._tag === 'Failure' ? result.failure : '')).toContain('terminal-no-command');
      expect(host.asked()['stop']).toBeUndefined();
    }),
  );

  it.effect('a restart re-watches an admitted background command: its ending discharges and delivers once', () =>
    restartedDelivery('restarted', false),
  );

  it.effect('a command moved to the background after its admission is owed its ending across a restart, delivered once', () =>
    restartedDelivery('moved-restarted', true),
  );

  it.effect('a command moved back to the foreground owes no ending of its own, and stays in its run', () =>
    Effect.gen(function* () {
      const admitted = execution('exec-command-moved-back');
      const floor = yield* floorOver(hostThat({ start: acceptedAs(admitted) }));
      yield* launched(floor, 'op-command-moved-back', 'foreground');
      expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
      expect(yield* floor.terminals.commands.foreground(admitted)).toBe('withdrawn');
      expect(yield* waitOf(admitted)).toMatchObject({ mode: 'foreground' });
      expect(yield* deliveryOf(admitted)).toBeNull();

      expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
      expect(yield* (yield* waitersFor()).take(admitted, holder)).toBe(true);
      expect(yield* floor.terminals.commands.foreground(admitted)).toBe('delivered');
    }),
  );

  it.effect('a command moved to, or admitted in, the background releases exactly its call’s own debt in the same write', () =>
    Effect.gen(function* () {
      const { store, units } = yield* Fixture;
      const admitted = execution('exec-command-carried');
      const floor = yield* floorOver(
        hostThat({
          start: acceptedAs(admitted),
          command: () => Effect.succeed({ state: commandState(admitted) } as unknown as CommandSnapshot),
        }),
        yield* waitersFor(undefined, yield* callDebts()),
      );
      yield* launched(floor, 'op-command-carried', 'foreground');
      const endings = yield* callEndings(
        units,
        () => Effect.succeed({ _tag: 'Accepted' } as const),
        yield* Queue.unbounded<CallAddress>(),
        yield* makeAgentCalls({ history: 8 }),
      );
      const call: CallRecord = {
        runId: 'run-1',
        toolCallId: 'call-1',
        threadId: holder,
        name: 'bash',
        input: {},
        phase: 'running',
        mode: 'background',
        detachable: false,
        startedAt: yield* Clock.currentTimeMillis,
        admittedAt: null,
        endedAt: null,
        expiresAt: null,
        expiresBy: null,
        limitCeilingMs: null,
        detail: null,
        executions: [],
      };
      yield* endings.owe(call);
      yield* endings.owe({ ...call, runId: 'run-other' });
      expect(yield* endings.owed({ threadId: holder })).toHaveLength(2);
      expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
      expect((yield* endings.owed({ threadId: holder })).map((owed) => owed.runId)).toEqual(['run-other']);
      expect(yield* deliveryOf(admitted)).not.toBeNull();

      const startFloor = yield* floorOver(
        hostThat({ start: acceptedAs(execution('exec-command-carried-at-start')) }),
        yield* waitersFor(undefined, yield* callDebts()),
      );
      yield* endings.owe({ ...call, toolCallId: 'call-1', runId: 'run-1' });
      yield* launched(startFloor, 'op-command-carried-at-start', 'background');
      expect((yield* endings.owed({ threadId: holder })).map((owed) => owed.runId)).toEqual(['run-other']);
    }),
  );

  it.effect('the notice of a moved command waits for the measurement its shell reports, and carries it', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-command-measured');
      const host = hostThat({
        start: acceptedAs(admitted),
        command: () => Effect.succeed({ state: { ...commandState(admitted), phase: 'ended' } } as unknown as CommandSnapshot),
        state: () => Effect.succeed(summaryOf(endedState(admitted, { _tag: 'Code', code: 0 }))),
        ending: () => Effect.succeed(endingOf(admitted)),
      });
      const ended = yield* Queue.unbounded<ExecutionRef>();
      const waiters = yield* waitersFor(ended);
      const floor = yield* floorOver(host, waiters);
      yield* launched(floor, 'op-command-measured', 'foreground');
      expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
      expect(Option.getOrUndefined(yield* Queue.poll(ended))).toEqual(admitted);
      const sent: string[] = [];
      const delivery = yield* commandDelivery({
        send: (input) => Effect.sync(() => (sent.push(input.text), { _tag: 'Accepted' } as const)),
      }).pipe(
        Effect.provideService(CommandWaiters, waiters),
        Effect.provideService(Terminals, floor.terminals),
        Effect.provideService(ManagedCommands, floor.terminals.commands),
        Effect.provideService(ExecutionRecords, floor.terminals),
      );
      expect(yield* delivery.deliver(admitted)).toEqual({ _tag: 'Kept', retryable: false });
      expect(sent).toEqual([]);
      const read = yield* commandOutputReader({
        commands: {
          ...floor.terminals.commands,
          bytes: (cursor: { readonly offset: ByteOffset }) =>
            Effect.succeed({
              range: { cursor, next: cursor.offset, retainedFrom: ByteOffset.make('0'), durableThrough: ByteOffset.make('0'), gap: false },
              bytes: new Uint8Array(0),
            }),
        } as unknown as ManagedCommands['Service'],
        reader: {
          one: () =>
            Effect.succeed({
              command: { execution: admitted, origin: { _tag: 'Thread', thread: holder, toolCall: 'call-1' } },
              live: { _tag: 'Held', entry: { state: { execution: admitted, phase: 'ended' }, deadline: {} }, readAt: 0 },
            } as unknown as CommandReading),
        },
        waiters,
      }).output({ projectId, reader: holder, thread: holder, execution: admitted, authority: {} as never });
      expect(read.phase).toBe('ended');
      expect(yield* deliveryOf(admitted)).not.toBeNull();
      const measured = '1 file moved while this ran, all attributed to this session.';
      yield* floor.terminals.commands.measured(admitted, measured);
      expect(Option.getOrUndefined(yield* Queue.poll(ended))).toEqual(admitted);
      expect(yield* delivery.deliver(admitted)).toEqual({ _tag: 'Settled' });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain(measured);
    }),
  );

  it.effect('a command moved to the background after its ending was already handled is driven to its notice at once', () =>
    Effect.gen(function* () {
      const movedLate = Effect.fnUntraced(function* (name: string, phase: 'running' | 'ended') {
        const admitted = execution(`exec-command-${name}`);
        const due = yield* Queue.unbounded<ExecutionRef>();
        const floor = yield* floorOver(
          hostThat({
            start: acceptedAs(admitted),
            command: () => Effect.succeed({ state: { ...commandState(admitted), phase } } as unknown as CommandSnapshot),
          }),
          yield* waitersFor(due),
        );
        yield* launched(floor, `op-command-${name}`, 'foreground');
        expect(yield* floor.terminals.commands.background(admitted)).toBe('moved');
        return Option.getOrUndefined(yield* Queue.poll(due));
      });
      expect(yield* movedLate('moved-running', 'running')).toBeUndefined();
      expect(yield* movedLate('moved-ended', 'ended')).toEqual(execution('exec-command-moved-ended'));
    }),
  );

  it.effect('a sweep repeated under its own key raises no second fence and stops nothing twice', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const reswept = ThreadId.make('thread-command-reswept');
      yield* threadRow(reswept);
      const gone = execution('exec-resweep-gone');
      const standing = execution('exec-resweep-standing');
      const host = hostThat({
        start: (operation) => acceptedAs(String(operation.operation) === 'op-resweep-2' ? standing : gone)(operation),
        stop: (ref) => Effect.succeed(receiptFor(ref, ref.execution === standing.execution ? { cleanup: 'pending' } : {})),
      });
      const floor = yield* floorOver(host);
      const actor = yield* actorOf(reswept);
      const owner: CommandSubject = { _tag: 'Thread', thread: reswept };
      for (const operationId of ['op-resweep-1', 'op-resweep-2']) yield* attempted(floor, operationId, actor, owner, creatorOf(reswept));
      const { key, authorize } = yield* sweepOf(floor, 'op-resweep-all', reswept, actor, owner);
      const sweepOnce = floor.terminals.commands.stopAll(projectId, [owner], key, authorize, 'explicit-stop', 'signal');

      const sweep = yield* sweepOnce;
      expect(sweep.fences).toEqual([1]);
      expect(sweep.stopped.map((receipt) => receipt.execution.execution).sort()).toEqual([gone.execution, standing.execution].sort());
      expect(sweep.refused).toEqual([]);
      expect(sweep.standing).toEqual([standing]);
      expect(host.asked()['stop']).toBe(2);

      expect(yield* sweepOnce).toMatchObject({ fences: [1], stopped: [], refused: [], standing: [standing] });
      expect(host.asked()['stop']).toBe(2);
    }),
  );

  it.effect('a run’s sweep ends only its foreground commands and leaves background and unscoped work standing', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const runner = ThreadId.make('thread-command-run-swept');
      yield* threadRow(runner);
      const earlier = execution('exec-run-sweep-earlier');
      const going = execution('exec-run-sweep-going');
      const unrun = execution('exec-run-sweep-unrun');
      const foreground = execution('exec-run-sweep-foreground');
      const accepted: Record<string, ExecutionRef> = {
        'op-run-sweep-foreground': foreground,
        'op-run-sweep-earlier': earlier,
        'op-run-sweep-going': going,
        'op-run-sweep-unrun': unrun,
      };
      const floor = yield* floorOver(
        hostThat({
          start: (operation) => acceptedAs(accepted[operation.operation]!)(operation),
          stop: (ref) => Effect.succeed(receiptFor(ref)),
        }),
      );
      const actor = yield* actorOf(runner);
      const owner: CommandSubject = { _tag: 'Thread', thread: runner };
      const launches: readonly (readonly [string, CommandCreator, CommandWaitMode | undefined])[] = [
        ['op-run-sweep-earlier', { _tag: 'Thread', thread: runner, run: 'run-earlier', toolCall: 'call-earlier' }, 'background'],
        ['op-run-sweep-going', { _tag: 'Thread', thread: runner, run: 'run-going', toolCall: 'call-going' }, 'foreground'],
        ['op-run-sweep-foreground', { _tag: 'Thread', thread: runner, run: 'run-going', toolCall: 'call-foreground' }, 'foreground'],
        ['op-run-sweep-unrun', { _tag: 'Thread', thread: runner }, undefined],
      ];
      for (const [operationId, creator, wait] of launches) yield* attempted(floor, operationId, actor, owner, creator, wait);
      expect(yield* floor.terminals.commands.background(going)).toBe('moved');
      const { key, authorize } = yield* sweepOf(floor, 'op-run-sweep', runner, actor, owner);
      const sweep = yield* floor.terminals.commands.stopAll(projectId, [owner], key, authorize, 'run-abort', 'signal', 'run-going');
      expect(sweep.stopped.map((receipt) => receipt.execution.execution)).toEqual([foreground.execution]);
      expect(yield* waitOf(foreground)).toBeNull();
      expect(yield* waitOf(earlier)).toMatchObject({ mode: 'background' });
      expect(yield* waitOf(going)).toMatchObject({ mode: 'background', revision: 1 });
      expect(yield* waitOf(unrun)).toMatchObject({ mode: 'foreground' });
    }),
  );
});
