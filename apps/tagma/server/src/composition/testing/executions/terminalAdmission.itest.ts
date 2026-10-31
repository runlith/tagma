import { fixtureMigrations } from '../migrations.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sessionIdentityLayer } from '../../../external-harnesses/testing/builtin.js';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { removeRule, terminalRequestKey, writeRule } from '../../../executions/testing/doubles.js';
import { Clock, Context, Effect, Layer, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import { THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import { ThreadResourceLedger, ThreadStore } from '@runlith/agent/thread/ThreadPorts';
import { resourceLedgerPorts } from '@runlith/agent/thread/conformance/resources';
import { threadStore } from '../../../native-harness/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions, ExecutionsFailure } from '@runlith/executions/Executions';
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
import { HostRefused, WireLost, WireUnavailable } from '@runlith/executions/Executions';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import {
  ExecutionId,
  InstallationId,
  HostRequestKey,
  type ExecutionRef,
  type HostRequestRef,
} from '@runlith/executions/protocol/execution';
import type { CustodyAnswer } from '@runlith/executions/protocol/control';
import { ByteOffset } from '@runlith/executions/protocol/record';
import type { ExecutionSummary, OperationAnswer } from '@runlith/executions/protocol/runtime';
import type { AuthorityAnswer } from '@runlith/executions/protocol/wire';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import type { LaunchRequest, StartAnswer } from '@runlith/executions/protocol/launch';
import type { EndingReceipt, StopReceipt } from '@runlith/executions/protocol/stop';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../../platform/contract/service/units.js';
import { unitsLayer } from '../../../platform/store/units.js';
import { runGit } from '../../../platform/git/ownGit.js';
import { machineFileLayer } from '../../../platform/store/open.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { rootUse as rootUseRow } from '../../../workspace/testing/doubles.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import { fixtureRoot } from '../../../platform/testing/roots.js';
import { holdThreadResources } from '../../../threads/testing/doubles.js';
import { terminalsKind } from '../../../threads/testing/doubles.js';
import { threadResourceStore } from '../../../threads/testing/doubles.js';
import { projectsLayer } from '../../../projects/testing/doubles.js';
import { fixtureGraph } from '../fixtureGraph.js';
import { hostWorkspace } from '../hostWorkspace.js';
import { worktreeRecordsLayer } from '../../../worktrees/layer.js';
import { Coverage, FileRoots, RootUses } from '../../../workspace/contract/service/roots.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';

const machineWorld = makeMachineWorld(() => null);
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { TargetKey, type ResolvedExecutionTarget } from '../../../executions/contract/wire/targets.js';
import type { TerminalOperationKey } from '../../../executions/contract/wire/requestKeys.js';
import { TERMINAL_PERMISSION_REVISION } from '../../../executions/contract/service/subjectPolicy.js';
import { executionTargets } from '../../../executions/testing/doubles.js';
import { guardedFloor, type GuardedFloor } from '../../../executions/testing/guardedFloor.js';
import { hostConnection } from '../../../executions/testing/doubles.js';
import { terminalExecutions } from '../../../executions/testing/doubles.js';
import { holdsOf, storesOver } from '../../../executions/testing/stores.js';
import type { TerminalGrants } from '../../../executions/contract/service/grants.js';
import { ENTRY_KINDS } from '../../manifest.js';

const installation = InstallationId.make('terminal-admission');
const targetKey = TargetKey.make('target-under-test');
const holder = ThreadId.make('thread-alpha');
const destination = ThreadId.make('thread-beta');

const undeclared = <A>(verb: string): Effect.Effect<A, ExecutionsFailure> =>
  new WireUnavailable({
    kind: 'unreachable',
    reason: `this fixture declares no answer for ${verb}`,
    sent: false,
  });

type HostAnswers = {
  readonly start?: (operation: HostRequestRef, launch: LaunchRequest) => Effect.Effect<StartAnswer, ExecutionsFailure>;
  readonly custody?: () => Effect.Effect<CustodyAnswer, ExecutionsFailure>;
  readonly input?: () => Effect.Effect<InputAnswer, ExecutionsFailure>;
  readonly operation?: (operation: HostRequestRef) => Effect.Effect<OperationAnswer, ExecutionsFailure>;
  readonly cancelStart?: Context.Service.Shape<typeof Executions>['cancelStart'];
  readonly generation?: Context.Service.Shape<typeof HostLifecycle>['generation'];
  readonly state?: () => Effect.Effect<ExecutionSummary | undefined, ExecutionsFailure>;
  readonly stop?: () => Effect.Effect<StopReceipt, ExecutionsFailure>;
  readonly ending?: () => Effect.Effect<EndingReceipt | undefined, ExecutionsFailure>;
  readonly openBinding?: () => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
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
    status: () => undeclared<never>('status'),
    list: () => undeclared<never>('list'),
    changes: () => undeclared<never>('changes'),
    state: () => {
      count('state');
      return answers.state?.() ?? undeclared<ExecutionSummary | undefined>('state');
    },
    operation: (operation: HostRequestRef) => {
      count('operation');
      return answers.operation?.(operation) ?? undeclared<OperationAnswer>('operation');
    },
    callResult: () => undeclared<never>('callResult'),
    preventStop: () => undeclared<never>('preventStop'),
    start: (operation: HostRequestRef, launch: LaunchRequest) => {
      count('start');
      return answers.start?.(operation, launch) ?? undeclared<StartAnswer>('start');
    },
    cancelStart: answers.cancelStart ?? (() => undeclared<never>('cancelStart')),
    read: () => undeclared<never>('read'),
    subscribe: () => Stream.fromEffect(undeclared<never>('subscribe')),
    screen: () => undeclared<never>('screen'),
    point: () => undeclared<never>('point'),
    input: () => {
      count('input');
      return answers.input?.() ?? undeclared<InputAnswer>('input');
    },
    signal: () => undeclared<never>('signal'),
    processes: () => undeclared<never>('processes'),
    foreground: () => undeclared<never>('foreground'),
    listeners: () => undeclared<never>('listeners'),
    hostListeners: () => undeclared<never>('hostListeners'),
    capabilities: () => undeclared<never>('capabilities'),
    generation: answers.generation ?? (() => undeclared<never>('generation')),
    served: () => undeclared<never>('served'),
    custody: () => {
      count('custody');
      return answers.custody?.() ?? undeclared<CustodyAnswer>('custody');
    },
    stop: () => {
      count('stop');
      return answers.stop?.() ?? undeclared<StopReceipt>('stop');
    },
    retire: () => undeclared<never>('retire'),
    ending: () => {
      count('ending');
      return answers.ending?.() ?? undeclared<EndingReceipt | undefined>('ending');
    },
    retained: () => undeclared<never>('retained'),
    command: () => undeclared<never>('command'),
    commands: () => undeclared<never>('commands'),
    commandsAt: () => undeclared<never>('commandsAt'),
    revise: () => undeclared<never>('revise'),
    take: () => undeclared<never>('take'),
    fence: () => undeclared<never>('fence'),
    release: () => undeclared<never>('release'),
    grant: () => undeclared<never>('grant'),
    openBinding: () => {
      count('openBinding');
      return answers.openBinding?.() ?? undeclared<AuthorityAnswer>('openBinding');
    },
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

const owned = fixtureRoot('terminal-admission', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'a-'));
const checkout = join(home, 'checkout');
mkdirSync(join(checkout, 'src'), { recursive: true });
const unrelated = join(home, 'unrelated');
mkdirSync(unrelated);

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

const fenced = ThreadId.make('thread-fenced');
const holding = ThreadId.make('thread-holding');
const idle = ThreadId.make('thread-idle');
const discharged = ThreadId.make('thread-discharged');
const stopped = ThreadId.make('thread-stopped');
const residualHolder = ThreadId.make('thread-residual');
const natural = ThreadId.make('thread-natural');
const observed = ThreadId.make('thread-observed');
const running = ThreadId.make('thread-running');
const endingClean = ThreadId.make('thread-ending-clean');
const endingHeld = ThreadId.make('thread-ending-held');
const endingFenced = ThreadId.make('thread-ending-fenced');
const dischargedAgain = ThreadId.make('thread-discharged-again');
const racing = ThreadId.make('thread-racing');

const bornIn = Effect.fnUntraced(function* (id: ThreadId) {
  const store = yield* MachineStore;
  const at = new Date(yield* Clock.currentTimeMillis);
  return yield* bornThread(store.db, {
    id,
    ownerId: 'owner',
    agentId: 'tagma',
    spawnRootId: id,
    cacheGroup: id,
    authority: THREAD_AUTHORITY_DEFAULT,
    createdAt: at,
    updatedAt: at,
  });
});

const seeded = Effect.gen(function* () {
  const git = yield* Git;
  yield* runGit(git, 'fixture', ['-C', checkout, 'init', '-q', '-b', 'main', '.']);
  yield* Effect.promise(() => Bun.write(join(checkout, 'src', 'a.ts'), 'export const one = 1;\n'));
  yield* runGit(git, 'fixture', ['-C', checkout, 'add', '--', 'src']);
  yield* runGit(git, 'fixture', ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'as it stood']);
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const rows = yield* store.db
    .insert(projectRow())
    .values({ name: 'terminals', repoKey: 'terminals-key', rootPath: checkout, createdAt })
    .returning({ id: projectRow().id });
  const projectId = rows[0]?.id ?? 0;
  for (const id of [
    holder,
    destination,
    fenced,
    holding,
    idle,
    discharged,
    stopped,
    residualHolder,
    natural,
    observed,
    running,
    endingClean,
    endingHeld,
    endingFenced,
    dischargedAgain,
    racing,
  ])
    yield* bornIn(id);
  const terminalStore = storesOver(store.db, installation);
  yield* (yield* Coverage).cover(projectId);
  const ledger = yield* threadResourceStore();
  return {
    store,
    units,
    rootUses: yield* RootUses,
    projectId,
    resolved: yield* (yield* executionTargets()).resolve({ projectId, kind: 'host', cwd: checkout }),
    terminalStore,
    ledger,
    walkLayer: resourceLedgerPorts<Unit<'machine'>, WriteUnit<'machine'>>(yield* threadStore(yield* makeThreadRecords, ENTRY_KINDS), {
      storage: ledger,
      kinds: [terminalsKind(holdsOf(terminalStore))],
    }),
  };
});

class Fixture extends Context.Service<Fixture, Effect.Success<typeof seeded>>()('terminalAdmission/Fixture') {}

const threadRow = bornIn;

const floorOver = Effect.fnUntraced(function* (host: ControlledHost) {
  return yield* guardedFloor({ port: host.port, guarded: host.port, db: (yield* Fixture).store.db, installation });
});

const portOf = Effect.fnUntraced(function* (terminals: GuardedFloor['terminals'], host: ControlledHost) {
  const { projectId } = yield* Fixture;
  return terminalExecutions({
    terminals,
    writing: terminals,
    evidence: terminals,
    discharge: terminals,
    host: hostConnection({ installation, state: 'test-state' }, host.port),
    caller: { actor: { _tag: 'Thread', threadId: holder, projectId } as const, projectId, kind: 'host' as const, root: checkout },
    scope: yield* Effect.scope,
  });
});

const summaryOf = (ref: ExecutionRef, holder: string): ExecutionSummary => ({
  state: {
    ref,
    transport: 'pipes',
    lifetime: 'held',
    purpose: 'command',
    phase: 'running',
    streams: { stdout: 'open', stderr: 'open', pty: 'open' },
    cleanup: 'pending',
    record: 'available',
  },
  custody: {
    revision: 3,
    holder: Principal.make(holder),
    origin: Principal.make(holder),
    target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
  },
  streams: [],
  native: { pid: 9090 },
  input: { acceptedThrough: ByteOffset.make('0'), pendingBytes: 0 },
});

const startOf = Effect.fnUntraced(function* (operationId: string, thread: ThreadId = holder) {
  const { projectId, resolved } = yield* Fixture;
  return {
    actor: { _tag: 'Thread', threadId: thread, projectId } as const,
    operationId: HostRequestKey.make(operationId),
    target: resolved,
    targetKey,
    program: '/bin/sh',
    args: ['-c', 'true'],
    transport: 'pipes' as const,
    lifetime: 'held' as const,
  };
});

const started = Effect.fnUntraced(function* (
  floor: { readonly terminals: GuardedFloor['terminals'] },
  operationId: string,
  thread: ThreadId = holder,
) {
  return yield* Effect.scoped(floor.terminals.start(yield* startOf(operationId, thread)));
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

const operationState = Effect.fnUntraced(function* (operationId: string) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.requestKeys.operation(unit, projectId, HostRequestKey.make(operationId)));
});

const intentOf = Effect.fnUntraced(function* (operationId: string) {
  const { units, terminalStore, projectId } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.intents.intent(unit, projectId, HostRequestKey.make(operationId)));
});

const fencesOf = Effect.fnUntraced(function* (thread: string) {
  const { units, terminalStore } = yield* Fixture;
  return yield* units.read((unit) => terminalStore.intents.fencesOf(unit, [ThreadId.make(thread)]));
});

const execution = (id: string): ExecutionRef => ({
  installation,
  execution: ExecutionId.make(id),
  incarnation: 1,
});

const startedHost = (ref: ExecutionRef, answers: HostAnswers): ControlledHost =>
  hostThat({
    start: (operation) =>
      Effect.succeed({
        _tag: 'Started' as const,
        operation,
        execution: ref,
        state: {
          ref,
          transport: 'pipes' as const,
          lifetime: 'held' as const,
          purpose: 'command' as const,
          phase: 'running' as const,
          streams: { stdout: 'open' as const, stderr: 'open' as const, pty: 'open' as const },
          cleanup: 'pending' as const,
          record: 'available' as const,
        },
        native: { pid: 4243 },
      }),
    ...answers,
  });

const launchedHost = (launches: LaunchRequest[], pid: number) =>
  hostThat({
    start: (operation, launch) => {
      launches.push(launch);
      const begun = execution(`exec-${operation.operation}`);
      return Effect.succeed({
        _tag: 'Started' as const,
        operation,
        execution: begun,
        state: {
          ref: begun,
          transport: 'pipes' as const,
          lifetime: 'held' as const,
          purpose: launch.purpose,
          phase: 'running' as const,
          streams: { stdout: 'open' as const, stderr: 'open' as const, pty: 'open' as const },
          cleanup: 'pending' as const,
          record: 'available' as const,
        },
        native: { pid },
      });
    },
  });

const keyOf = Effect.fnUntraced(function* (operationId: string, mutation: 'transfer' | 'stop', thread: ThreadId, ref?: ExecutionRef) {
  const { projectId } = yield* Fixture;
  return {
    projectId,
    operationId: HostRequestKey.make(operationId),
    requester: Principal.make(`thread:${thread}`),
    mutation,
    targetKey,
    execution: ref,
  } satisfies TerminalOperationKey;
});

const moveTo = { _tag: 'Transfer', holder: Principal.make(`thread:${destination}`) } as const;
const asHolder = Principal.make(`thread:${holder}`);

const moved = Effect.fnUntraced(function* (
  floor: { readonly terminals: GuardedFloor['terminals'] },
  operationId: string,
  ref: ExecutionRef,
  revision = 0,
) {
  const { projectId } = yield* Fixture;
  return yield* floor.terminals.move(projectId, yield* keyOf(operationId, 'transfer', holder, ref), ref, revision, moveTo, asHolder);
});

const stoppedBy = Effect.fnUntraced(function* (
  floor: { readonly terminals: GuardedFloor['terminals'] },
  operationId: string,
  thread: ThreadId,
  ref: ExecutionRef,
  cause: 'explicit-stop' | 'scope-closed' = 'explicit-stop',
) {
  const { projectId } = yield* Fixture;
  return yield* floor.terminals.stop(projectId, yield* keyOf(operationId, 'stop', thread, ref), ref, 0, cause, 'signal');
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

const dischargedWith = Effect.fnUntraced(function* (
  floor: { readonly terminals: GuardedFloor['terminals'] },
  ref: ExecutionRef,
  receipt: EndingReceipt,
) {
  return yield* floor.terminals.discharge((yield* Fixture).projectId, ref, receipt);
});

const releasing = Effect.fnUntraced(function* (thread: ThreadId) {
  const { units, terminalStore } = yield* Fixture;
  const heldAt = new Date(yield* Clock.currentTimeMillis);
  return yield* Effect.result(
    units.write('admission.releasing', (unit) =>
      terminalsKind(holdsOf(terminalStore)).end!([{ id: thread, kind: 'terminals', threadId: thread, heldAt }], unit),
    ),
  );
});

const born = Effect.fnUntraced(function* (thread: ThreadId) {
  const { units, ledger, projectId } = yield* Fixture;
  return yield* units.write('admission.born', (unit) => holdThreadResources(ledger, { threadId: thread, projectId }, unit));
});

const heldRow = Effect.fnUntraced(function* (thread: ThreadId) {
  return (yield* (yield* Fixture).ledger.held([thread])).find((row) => row.kind === 'terminals') ?? null;
});

const endThread = Effect.fnUntraced(function* (thread: ThreadId) {
  const { units, terminalStore } = yield* Fixture;
  const row = yield* heldRow(thread);
  if (row === null) return yield* Effect.die(`no terminals row was produced for ${thread}`);
  return yield* Effect.result(units.write('admission.endThread', (unit) => terminalsKind(holdsOf(terminalStore)).end!([row], unit)));
});

const laneOver = (ref: ExecutionRef) => ({ execution: ref, road: 'agent' as const });
const holderLane = {
  binding: BindingId.make('binding-3'),
  principal: asHolder,
  decisionRevision: TERMINAL_PERMISSION_REVISION,
};

const settled = Effect.fnUntraced(function* (floor: { readonly grants: TerminalGrants['Service'] }, ref: ExecutionRef) {
  return yield* floor.grants.settle((yield* Fixture).projectId, targetKey, laneOver(ref), holderLane);
});

const walkRouted = ThreadId.make('thread-walk-routed');
const walkRefused = ThreadId.make('thread-walk-refused');
const walkUnknown = ThreadId.make('thread-walk-unknown');
const walkClean = ThreadId.make('thread-walk-clean');

const holdWalkRow = Effect.fnUntraced(function* (thread: ThreadId, kind = 'terminals', id: string = thread) {
  return yield* (yield* Fixture).ledger.hold({ kind, id, threadId: thread });
});

const walkEnding = Effect.fnUntraced(function* (thread: ThreadId) {
  return yield* Effect.result(
    Effect.gen(function* () {
      const threads = yield* ThreadStore;
      const walked = yield* ThreadResourceLedger;
      yield* threads.transaction((unit) => walked.end([thread], unit));
    }).pipe(Effect.provide((yield* Fixture).walkLayer)),
  );
});

const messageOf = (result: { readonly _tag: string; readonly failure?: unknown }) =>
  result._tag === 'Failure' ? String((result.failure as { readonly message?: unknown }).message) : result._tag;

const refusedHost = () =>
  hostThat({
    start: (operation) =>
      Effect.succeed({
        _tag: 'Refused' as const,
        operation,
        refusal: { _tag: 'UnsupportedCapability' as const, reason: 'this host serves no held pipes' },
      }),
  });

const lostHost = () => hostThat({ start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }) });

layer(Layer.provideMerge(Layer.effect(Fixture, seeded), environment), { excludeTestServices: true })('terminal admission', (it) => {
  it.effect('a host refusal before any effect gives back what the admission reserved', () =>
    Effect.gen(function* () {
      expect((yield* started(yield* floorOver(refusedHost()), 'op-refused'))._tag).toBe('Refused');
      expect(yield* operationState('op-refused')).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf('op-refused')).toBeNull();
      expect(yield* heldBy('op-refused')).toEqual([]);
    }),
  );

  it.effect('a root registered elsewhere between admission and reservation does not refuse the start', () =>
    Effect.gen(function* () {
      const roots = yield* FileRoots;
      const floor = yield* floorOver(refusedHost());
      const receipt = yield* Effect.scoped(
        floor.terminals.start({
          ...(yield* startOf('op-registry-moved')),
          prepared: () => Effect.asVoid(roots.register({ path: unrelated, provenance: { kind: 'adoption', id: 'operator' } })),
        }),
      );
      expect(receipt._tag).toBe('Refused');
      expect(yield* heldBy('op-registry-moved')).toEqual([]);
    }),
  );

  it.effect('a start cancelled before any spawn releases its reservation and keeps its key', () =>
    Effect.gen(function* () {
      const host = hostThat({ start: (operation) => Effect.succeed({ _tag: 'Cancelled' as const, operation }) });
      const receipt = yield* started(yield* floorOver(host), 'op-cancelled');
      expect(receipt._tag === 'Refused' ? receipt.refusal.reason : receipt._tag).toBe('stale');
      expect(yield* operationState('op-cancelled')).toMatchObject({ _tag: 'Settled' });
      expect(yield* heldBy('op-cancelled')).toEqual([]);
    }),
  );

  it.effect('a request that never left this process releases what it reserved', () =>
    Effect.gen(function* () {
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'absent', reason: 'nothing is installed here', sent: false }),
      });
      expect((yield* Effect.result(started(yield* floorOver(host), 'op-unsent')))._tag).toBe('Failure');
      expect(yield* operationState('op-unsent')).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf('op-unsent')).toBeNull();
      expect(yield* heldBy('op-unsent')).toEqual([]);
    }),
  );

  it.effect.each([
    new HostRefused({ refusal: { _tag: 'CapacityExceeded', reason: 'no admission slot' } }),
    new WireLost({ reason: 'closed before the write', sent: false }),
  ])('a definite admission failure frees reservations and the operation slot', (failure) =>
    Effect.gen(function* () {
      const id = `op-definite-${failure._tag}`;
      const host = hostThat({ start: () => Effect.fail(failure) });
      expect((yield* Effect.result(started(yield* floorOver(host), id)))._tag).toBe('Failure');
      expect(yield* operationState(id)).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf(id)).toBeNull();
      expect(yield* heldBy(id)).toEqual([]);
    }),
  );

  it.effect('boot recovery fences an unadmitted start with no generation and releases its durable holdings', () =>
    Effect.gen(function* () {
      const { store } = yield* Fixture;
      const id = 'op-boot-unadmitted';
      let prevented = false;
      const host = hostThat({
        start: () => Effect.fail(new WireLost({ reason: 'reply lost', sent: true })),
        generation: () => Effect.succeed(0),
        operation: (operation) =>
          Effect.succeed(
            operation.operation === id
              ? prevented
                ? { _tag: 'Cancelled', operation }
                : { _tag: 'Unanswered', operation }
              : { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } },
          ),
        cancelStart: Effect.fnUntraced(function* (operation, _cause, _trigger, when) {
          if (operation.operation !== id || when !== 'unadmitted')
            return yield* Effect.die(new Error('recovery tried to cancel admitted or unrelated work'));
          prevented = true;
          return { _tag: 'Prevented' as const, operation };
        }),
      });
      const floor = yield* floorOver(host);
      yield* Effect.result(started(floor, id));
      expect((yield* heldBy(id)).length).toBe(1);
      yield* store.db
        .update(terminalRequestKey())
        .set({ at: new Date(0) })
        .where(eq(terminalRequestKey().operationId, id));
      const product = yield* portOf(floor.terminals, host);
      const recovery = yield* floorOver({ ...host, port: { ...host.port, cancelStart: product.cancelStart } });
      yield* recovery.terminals.sweepReplaced();
      expect(yield* operationState(id)).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf(id)).toBeNull();
      expect(yield* heldBy(id)).toEqual([]);
    }),
  );

  it.effect('a start whose reply nobody received keeps its dependencies and its fence', () =>
    Effect.gen(function* () {
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the owner did not answer', sent: true }),
      });
      expect((yield* Effect.result(started(yield* floorOver(host), 'op-uncertain')))._tag).toBe('Failure');
      expect(yield* operationState('op-uncertain')).toMatchObject({ _tag: 'Uncertain' });
      expect(yield* intentOf('op-uncertain')).toMatchObject({ phase: 'uncertain', incoming: holder });
      expect((yield* heldBy('op-uncertain')).length).toBe(1);
      expect((yield* fencesOf(holder)).map((key) => String(key.operationId))).toContain('op-uncertain');
    }),
  );

  it.effect('a lost start reply is recovered by its own key and never by a second launch', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-recovered');
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }),
        operation: () =>
          Effect.succeed({
            _tag: 'Accepted' as const,
            operation: { installation, operation: HostRequestKey.make('op-lost') },
            execution: admitted,
          }),
      });
      const floor = yield* floorOver(host);
      expect((yield* Effect.result(started(floor, 'op-lost')))._tag).toBe('Failure');
      const recovered = yield* floor.terminals.request(projectId, HostRequestKey.make('op-lost'));
      expect(recovered._tag === 'Admitted' ? recovered.execution.execution : recovered._tag).toBe(admitted.execution);
      expect(host.asked()['start']).toBe(1);
      expect((yield* intentOf('op-lost'))?.phase).toBe('uncertain');
    }),
  );

  it.effect('a key that was already taken answers itself instead of starting a second execution', () =>
    Effect.gen(function* () {
      const host = refusedHost();
      const floor = yield* floorOver(host);
      yield* started(floor, 'op-repeat');
      expect((yield* started(floor, 'op-repeat'))._tag).toBe('Refused');
      expect(host.asked()['start']).toBe(1);
    }),
  );

  it.effect('a receipt the host vouches for is projected before its fence comes down', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const admitted = execution('exec-reconciled');
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }),
        operation: () =>
          Effect.succeed({
            _tag: 'Accepted' as const,
            operation: { installation, operation: HostRequestKey.make('op-reconciled') },
            execution: admitted,
          }),
        state: () => Effect.succeed(summaryOf(admitted, `thread:${holder}`)),
      });
      const floor = yield* floorOver(host);
      yield* Effect.result(started(floor, 'op-reconciled'));
      yield* floor.terminals.request(projectId, HostRequestKey.make('op-reconciled'));
      expect((yield* intentOf('op-reconciled'))?.phase).toBe('uncertain');

      expect((yield* floor.reconciliation.operation(projectId, HostRequestKey.make('op-reconciled')))._tag).toBe('Settled');
      expect(yield* intentOf('op-reconciled')).toBeNull();
      const projected = yield* floor.terminals.record(admitted.execution, admitted.incarnation);
      expect(String(projected?.holder)).toBe(`thread:${holder}`);
      expect(projected?.revision).toBe(3);
      expect(projected?.quarantine).toBeUndefined();
    }),
  );

  it.effect('a receipt with an unplaceable holder is quarantined and refuses a custody act', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const stranger = execution('exec-stranger');
      const host = hostThat({
        start: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }),
        operation: () =>
          Effect.succeed({
            _tag: 'Accepted' as const,
            operation: { installation, operation: HostRequestKey.make('op-stranger-start') },
            execution: stranger,
          }),
        state: () => Effect.succeed(summaryOf(stranger, 'daemon')),
        custody: () =>
          Effect.succeed({
            _tag: 'Uncertain' as const,
            effect: { _tag: 'InFlight' as const, operation: { installation, operation: HostRequestKey.make('op-stranger') } },
          }),
      });
      const floor = yield* floorOver(host);
      yield* Effect.result(started(floor, 'op-stranger-start'));
      yield* floor.terminals.request(projectId, HostRequestKey.make('op-stranger-start'));
      const projected = yield* floor.reconciliation.projection(projectId, stranger);
      expect(projected?.quarantine).toBe('unknown-principal');
      expect(projected?.heldBy).toBeUndefined();

      const refused = yield* Effect.result(
        floor.terminals.move(
          projectId,
          yield* keyOf('op-stranger', 'transfer', holder, stranger),
          stranger,
          3,
          { _tag: 'Transfer', holder: asHolder },
          asHolder,
        ),
      );
      expect(refused._tag === 'Failure' ? refused.failure._tag : refused._tag).toBe('TerminalRefused');
      expect(host.asked()['custody']).toBeUndefined();
    }),
  );

  it.effect('an execution this installation never admitted is not projected into the asking project', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const foreign = execution('exec-never-admitted');
      const floor = yield* floorOver(hostThat({ state: () => Effect.succeed(summaryOf(foreign, `thread:${holder}`)) }));
      expect(yield* floor.reconciliation.projection(projectId, foreign)).toBeNull();
      expect(yield* floor.terminals.record(foreign.execution, foreign.incarnation)).toBeNull();
    }),
  );

  it.effect(
    "a terminal is launched paced when a thread holds it or it serves a thread, and never as Tagma's own work or the operator's",
    () =>
      Effect.gen(function* () {
        const launches: LaunchRequest[] = [];
        const floor = yield* floorOver(launchedHost(launches, 4242));
        const operator = { _tag: 'Operator' } as const;
        const starts = [
          yield* startOf('op-paced-thread'),
          { ...(yield* startOf('op-paced-internal')), purpose: 'internal' as const },
          { ...(yield* startOf('op-paced-operator')), actor: operator },
          { ...(yield* startOf('op-paced-harness')), actor: operator, launchedFor: holder },
        ];
        for (const start of starts) expect((yield* Effect.scoped(floor.terminals.start(start)))._tag).toBe('Started');
        expect(launches.map((launch) => launch.paced ?? false)).toEqual([true, false, false, true]);
      }),
  );

  it.effect('a terminal launches with no deadline while a wait and a life rule stand over every command of the machine', () =>
    Effect.gen(function* () {
      const { store } = yield* Fixture;
      const rules = yield* Effect.forEach(['wait', 'life'] as const, (measure) =>
        writeRule(store, {
          projectId: null,
          thread: null,
          through: null,
          program: null,
          measure,
          limitMs: 1_000,
          writer: 'operator',
          words: `one second of ${measure} everywhere`,
          position: { at: 'end' },
        }),
      );
      const launches: LaunchRequest[] = [];
      const floor = yield* floorOver(launchedHost(launches, 4243));
      yield* Effect.gen(function* () {
        expect((yield* started(floor, 'op-unbounded-terminal'))._tag).toBe('Started');
        expect(launches).toHaveLength(1);
        expect(launches[0]).toMatchObject({ lifetime: 'held' });
        expect(launches[0] !== undefined && 'budget' in launches[0] ? launches[0].budget : undefined).toBeUndefined();
      }).pipe(Effect.ensuring(Effect.orDie(Effect.forEach(rules, (rule) => removeRule(store, rule.rule.id)))));
    }),
  );

  it.effect('an uncertain transfer keeps both custody threads fenced', () =>
    Effect.gen(function* () {
      const ref = execution('exec-transferred');
      const floor = yield* floorOver(
        startedHost(ref, {
          custody: () =>
            Effect.succeed({
              _tag: 'Uncertain' as const,
              effect: { _tag: 'InFlight' as const, operation: { installation, operation: HostRequestKey.make('op-transfer') } },
            }),
        }),
      );
      expect((yield* started(floor, 'op-held'))._tag).toBe('Started');
      expect((yield* moved(floor, 'op-transfer', ref))._tag).toBe('Uncertain');
      expect(yield* operationState('op-transfer')).toMatchObject({ _tag: 'Uncertain' });
      expect(yield* intentOf('op-transfer')).toMatchObject({ outgoing: holder, incoming: destination });
      expect((yield* fencesOf(holder)).map((key) => String(key.operationId))).toContain('op-transfer');
      expect((yield* fencesOf(destination)).map((key) => String(key.operationId))).toContain('op-transfer');
    }),
  );

  it.effect('a custody act under a key that is already taken is answered, never sent twice', () =>
    Effect.gen(function* () {
      const ref = execution('exec-retried');
      const host = startedHost(ref, {
        custody: () =>
          Effect.succeed({
            _tag: 'Uncertain' as const,
            effect: { _tag: 'InFlight' as const, operation: { installation, operation: HostRequestKey.make('op-retried') } },
          }),
      });
      const floor = yield* floorOver(host);
      yield* started(floor, 'op-held-retried');
      expect((yield* moved(floor, 'op-retried', ref))._tag).toBe('Uncertain');
      const again = yield* Effect.result(moved(floor, 'op-retried', ref));
      expect(again._tag === 'Failure' && again.failure._tag === 'TerminalRefused' ? again.failure.reason : again._tag).toBe(
        'operation-conflict',
      );
      expect(host.asked()['custody']).toBe(1);
    }),
  );

  it.effect('a transfer that never left this process takes its fence down', () =>
    Effect.gen(function* () {
      const ref = execution('exec-unsent-transfer');
      const floor = yield* floorOver(
        startedHost(ref, {
          custody: () => new WireUnavailable({ kind: 'absent', reason: 'nothing is installed here', sent: false }),
        }),
      );
      yield* started(floor, 'op-held-unsent');
      expect((yield* Effect.result(moved(floor, 'op-unsent-transfer', ref)))._tag).toBe('Failure');
      expect(yield* operationState('op-unsent-transfer')).toMatchObject({ _tag: 'Settled' });
      expect(yield* intentOf('op-unsent-transfer')).toBeNull();
      expect((yield* fencesOf(destination)).map((entry) => String(entry.operationId))).not.toContain('op-unsent-transfer');
    }),
  );

  it.effect('a custody act the ledger and the host both have nothing for is never sent', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const host = hostThat({
        state: () => Effect.succeed(undefined),
        custody: () =>
          Effect.succeed({
            _tag: 'Uncertain' as const,
            effect: { _tag: 'InFlight' as const, operation: { installation, operation: HostRequestKey.make('op-unprojected') } },
          }),
      });
      const failed = yield* Effect.result(
        (yield* floorOver(host)).terminals.move(
          projectId,
          yield* keyOf('op-unprojected', 'transfer', holder),
          execution('exec-unknown'),
          0,
          { _tag: 'Transfer', holder: Principal.make('operator') },
          asHolder,
        ),
      );
      expect(failed._tag === 'Failure' ? failed.failure._tag : failed._tag).toBe('TerminalUnavailable');
      expect(host.asked()['custody']).toBeUndefined();
    }),
  );

  it.effect('a stop that proved a clean ending discharges the custody it earned', () =>
    Effect.gen(function* () {
      const ref = execution('exec-stopped');
      const floor = yield* floorOver(startedHost(ref, { stop: () => Effect.succeed(receiptFor(ref)) }));
      yield* started(floor, 'op-stopped-start', stopped);
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBe(stopped);
      expect((yield* stoppedBy(floor, 'op-stopping', stopped, ref)).cleanup).toBe('complete');
      const after = yield* floor.terminals.record(ref.execution, ref.incarnation);
      expect(after?.heldBy).toBeUndefined();
      expect(String(after?.holder)).toBe(`thread:${stopped}`);
      expect(yield* heldBy('op-stopped-start')).toEqual([]);
      expect((yield* releasing(stopped))._tag).toBe('Success');
    }),
  );

  it.effect('a stop with residual work leaves the thread holding it', () =>
    Effect.gen(function* () {
      const ref = execution('exec-stopped-residual');
      const floor = yield* floorOver(
        startedHost(ref, {
          stop: () =>
            Effect.succeed(
              receiptFor(ref, {
                cleanup: 'residual',
                residual: [{ kind: 'process', detail: 'a descendant survived', pid: 4343 }],
              }),
            ),
        }),
      );
      yield* started(floor, 'op-residual-start', residualHolder);
      yield* stoppedBy(floor, 'op-residual-stop', residualHolder, ref);
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBe(residualHolder);
      expect((yield* releasing(residualHolder))._tag).toBe('Failure');
    }),
  );

  it.effect('an execution observed to have ended is discharged from the host’s own measurement', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-observed-end');
      const floor = yield* floorOver(startedHost(ref, { ending: () => Effect.succeed(endingOf(ref)) }));
      yield* started(floor, 'op-observed-start', observed);
      expect(yield* floor.terminals.ended(projectId, ref)).toEqual({ _tag: 'Discharged' } as never);
      const after = yield* floor.terminals.record(ref.execution, ref.incarnation);
      expect(after?.heldBy).toBeUndefined();
      expect(String(after?.holder)).toBe(`thread:${observed}`);
      expect(yield* heldBy('op-observed-start')).toEqual([]);
      expect((yield* releasing(observed))._tag).toBe('Success');
    }),
  );

  it.effect('an execution the host holds no ending for stays held', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-still-running');
      const floor = yield* floorOver(startedHost(ref, { ending: () => Effect.succeed(undefined) }));
      yield* started(floor, 'op-running-start', running);
      expect(yield* floor.terminals.ended(projectId, ref)).toEqual({ _tag: 'Retained', reason: 'unended' } as never);
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBe(running);
      expect((yield* releasing(running))._tag).toBe('Failure');
    }),
  );

  it.effect('an ending nobody asked for discharges on its own evidence', () =>
    Effect.gen(function* () {
      const ref = execution('exec-natural');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-natural-start', natural);
      expect(yield* dischargedWith(floor, ref, endingOf(ref))).toEqual({ _tag: 'Discharged' } as never);
      const after = yield* floor.terminals.record(ref.execution, ref.incarnation);
      expect(after?.heldBy).toBeUndefined();
      expect(String(after?.holder)).toBe(`thread:${natural}`);
      expect(yield* heldBy('op-natural-start')).toEqual([]);
      expect((yield* releasing(natural))._tag).toBe('Success');
    }),
  );

  it.effect('nothing short of a complete, unresidual, measured, unfenced ending discharges', () =>
    Effect.gen(function* () {
      const ref = execution('exec-discharge');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-discharge-start', discharged);
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBe(discharged);

      const short: ReadonlyArray<readonly [Partial<StopReceipt>, string]> = [
        [{ cleanup: 'residual' }, 'incomplete-cleanup'],
        [{ residual: [{ kind: 'process', detail: 'a descendant survived', pid: 4242 }] }, 'residual'],
        [{ unverifiable: [{ kind: 'process', detail: 'the group', reason: 'it could not be read' }] }, 'unmeasured'],
        [{ execution: { ...ref, incarnation: ref.incarnation + 1 } }, 'foreign-reference'],
      ];
      for (const [over, reason] of short) {
        expect(yield* dischargedWith(floor, ref, receiptFor(ref, over))).toEqual({ _tag: 'Retained', reason } as never);
      }
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBe(discharged);
      expect((yield* heldBy('op-discharge-start')).length).toBe(1);

      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Discharged' } as never);
      const after = yield* floor.terminals.record(ref.execution, ref.incarnation);
      expect(after?.heldBy).toBeUndefined();
      expect(String(after?.holder)).toBe(`thread:${discharged}`);
      expect(after?.execution.execution).toBe(ref.execution);
      expect(yield* heldBy('op-discharge-start')).toEqual([]);
      expect((yield* releasing(discharged))._tag).toBe('Success');
    }),
  );

  it.effect('an unresolved operation over an execution refuses to discharge it', () =>
    Effect.gen(function* () {
      const ref = execution('exec-unsettled');
      const floor = yield* floorOver(
        startedHost(ref, {
          custody: () => new WireUnavailable({ kind: 'unreachable', reason: 'the reply was lost', sent: true }),
        }),
      );
      yield* started(floor, 'op-unsettled-start', fenced);
      yield* Effect.result(moved(floor, 'op-unsettled-move', ref));
      expect(yield* intentOf('op-unsettled-move')).not.toBeNull();
      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Retained', reason: 'unresolved-operation' } as never);
    }),
  );

  it.effect('a thread holding no execution and fencing nothing ends', () =>
    Effect.gen(function* () {
      expect((yield* releasing(idle))._tag).toBe('Success');
    }),
  );

  it.effect('an operation nobody can attribute yet refuses the thread it fences', () =>
    Effect.gen(function* () {
      yield* Effect.result(started(yield* floorOver(lostHost()), 'op-fencing', fenced));
      expect(messageOf(yield* releasing(fenced))).toContain('op-fencing');
    }),
  );

  it.effect('a refused release rolls the ending’s whole unit back', () =>
    Effect.gen(function* () {
      const { units, terminalStore, projectId } = yield* Fixture;
      const thread = ThreadId.make('thread-rollback-fenced');
      yield* threadRow(thread);
      yield* Effect.result(started(yield* floorOver(lostHost()), 'op-rollback-fence', thread));
      const ending = yield* Effect.result(
        units.write('admission.ending', (unit) =>
          Effect.gen(function* () {
            yield* terminalStore.requestKeys.register(unit, {
              projectId,
              operationId: HostRequestKey.make('op-rolled-back'),
              requester: Principal.make(`thread:${thread}`),
              mutation: 'stop',
              targetKey,
            });
            yield* terminalsKind(holdsOf(terminalStore)).end!(
              [{ id: thread, kind: 'terminals', threadId: thread, heldAt: new Date(yield* Clock.currentTimeMillis) }],
              unit,
            );
          }),
        ),
      );
      expect(ending._tag).toBe('Failure');
      expect((yield* operationState('op-rolled-back'))._tag).toBe('Unknown');
    }),
  );

  it.effect('an execution still in a thread’s custody refuses that thread’s ending', () =>
    Effect.gen(function* () {
      yield* started(yield* floorOver(startedHost(execution('exec-in-custody'), {})), 'op-in-custody', holding);
      expect(yield* intentOf('op-in-custody')).toBeNull();
      expect(messageOf(yield* releasing(holding))).toContain('exec-in-custody');
    }),
  );

  it.effect('a replaced custodian ends every grant over the reference it replaced', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-replaced');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-replaced');
      yield* settled(floor, ref);
      expect(floor.grants.over(projectId, ref).length).toBe(1);
      yield* floor.reconciliation.projection(projectId, { ...ref, incarnation: ref.incarnation + 1 });
      expect(floor.grants.over(projectId, ref)).toEqual([]);
    }),
  );

  it.effect('a reference that did not move leaves the grants over it alone', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-not-replaced');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-not-replaced');
      yield* settled(floor, ref);
      yield* floor.reconciliation.projection(projectId, ref);
      expect(floor.grants.over(projectId, ref).length).toBe(1);
    }),
  );

  it.effect('a repeated discharge closes grants and a later custody projection restores no root accounting', () =>
    Effect.gen(function* () {
      const { store, units, terminalStore, projectId } = yield* Fixture;
      const ref = execution('exec-discharged-again');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-discharged-again', dischargedAgain);
      const [use] = yield* heldBy('op-discharged-again');
      if (use === undefined) return yield* Effect.die('the start held no root use');
      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Discharged' } as never);

      yield* settled(floor, ref);
      expect(yield* store.db.select().from(rootUseRow()).where(eq(rootUseRow().useId, use.useId))).toEqual([]);
      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Discharged' } as never);
      expect(floor.grants.over(projectId, ref)).toEqual([]);
      expect(yield* heldBy('op-discharged-again')).toEqual([]);

      const record = yield* floor.terminals.record(ref.execution, ref.incarnation);
      if (record === null) return yield* Effect.die('the discharged row is gone');
      yield* units.write('admission', (unit) =>
        terminalStore.terminalRows.project(unit, { ...record, revision: record.revision + 1, heldBy: dischargedAgain }),
      );
      const projected = yield* floor.terminals.record(ref.execution, ref.incarnation);
      expect(projected?.revision).toBe(record.revision + 1);
      expect(projected?.heldBy).toBeUndefined();
      expect((yield* releasing(dischargedAgain))._tag).toBe('Success');
    }),
  );

  it.effect('a stop and an observed ending discharging one execution at once both end its custody', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-discharge-racing');
      const floor = yield* floorOver(
        startedHost(ref, {
          stop: () => Effect.succeed(receiptFor(ref)),
          ending: () => Effect.succeed(endingOf(ref)),
        }),
      );
      yield* started(floor, 'op-racing-start', racing);
      const [receipt, ended] = yield* Effect.all(
        [stoppedBy(floor, 'op-racing-stop', racing, ref, 'scope-closed'), floor.terminals.ended(projectId, ref)],
        { concurrency: 'unbounded' },
      );
      expect(receipt.cleanup).toBe('complete');
      expect(ended).toEqual({ _tag: 'Discharged' } as never);
      expect((yield* floor.terminals.record(ref.execution, ref.incarnation))?.heldBy).toBeUndefined();
      expect(yield* heldBy('op-racing-start')).toEqual([]);
      expect((yield* releasing(racing))._tag).toBe('Success');
    }),
  );

  it.effect('every thread is born holding a terminals row, and the registered kind answers to its word', () =>
    Effect.gen(function* () {
      const { terminalStore } = yield* Fixture;
      yield* born(endingClean);
      const row = yield* heldRow(endingClean);
      expect(row?.threadId).toBe(endingClean);
      expect(row?.kind).toBe(terminalsKind(holdsOf(terminalStore)).kind);
    }),
  );

  it.effect('a thread whose execution was discharged ends through its own row', () =>
    Effect.gen(function* () {
      yield* born(endingClean);
      const ref = execution('exec-ending-clean');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-ending-clean', endingClean);
      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Discharged' } as never);
      expect((yield* endThread(endingClean))._tag).toBe('Success');
    }),
  );

  it.effect('a thread still holding an execution refuses its ending through its own row', () =>
    Effect.gen(function* () {
      yield* born(endingHeld);
      yield* started(yield* floorOver(startedHost(execution('exec-ending-held'), {})), 'op-ending-held', endingHeld);
      expect(messageOf(yield* endThread(endingHeld))).toContain('exec-ending-held');
    }),
  );

  it.effect('a thread fenced by an unattributable operation refuses its ending through its own row', () =>
    Effect.gen(function* () {
      yield* born(endingFenced);
      yield* Effect.result(started(yield* floorOver(lostHost()), 'op-ending-fenced', endingFenced));
      expect(messageOf(yield* endThread(endingFenced))).toContain('op-ending-fenced');
    }),
  );

  it.effect('the walk routes a terminals row to the terminals kind', () =>
    Effect.gen(function* () {
      yield* threadRow(walkRouted);
      yield* holdWalkRow(walkRouted);
      const host = startedHost(execution('exec-walk-routed'), {});
      yield* started(yield* floorOver(host), 'op-walk-routed', walkRouted);
      expect(messageOf(yield* walkEnding(walkRouted))).toContain('exec-walk-routed');
      expect(host.asked()['custody']).toBeUndefined();
      expect(host.asked()['state']).toBeUndefined();
      expect(host.asked()['ending']).toBeUndefined();
    }),
  );

  it.effect('a refusing kind fails the walk as ThreadCallBroke naming the kind and the id', () =>
    Effect.gen(function* () {
      const { ledger } = yield* Fixture;
      yield* threadRow(walkRefused);
      yield* holdWalkRow(walkRefused);
      yield* started(yield* floorOver(startedHost(execution('exec-walk-refused'), {})), 'op-walk-refused', walkRefused);
      const refused = yield* walkEnding(walkRefused);
      expect(refused._tag === 'Failure' ? refused.failure._tag : refused._tag).toBe('ThreadCallBroke');
      expect(messageOf(refused)).toContain('terminals');
      expect(messageOf(refused)).toContain(walkRefused);
      expect((yield* ledger.held([walkRefused])).map((row) => row.kind)).toContain('terminals');
    }),
  );

  it.effect('a row whose kind nothing declared refuses the walk', () =>
    Effect.gen(function* () {
      const { ledger } = yield* Fixture;
      yield* threadRow(walkUnknown);
      yield* holdWalkRow(walkUnknown, 'walk-unknown-kind');
      const refused = yield* walkEnding(walkUnknown);
      expect(refused._tag === 'Failure' ? refused.failure._tag : refused._tag).toBe('ThreadCallBroke');
      expect(messageOf(refused)).toContain('walk-unknown-kind');
      expect(messageOf(refused)).toContain(walkUnknown);
      expect((yield* ledger.held([walkUnknown])).length).toBe(1);
    }),
  );

  it.effect('a clean walk ends every row it walked and refuses none', () =>
    Effect.gen(function* () {
      const { ledger } = yield* Fixture;
      yield* threadRow(walkClean);
      yield* holdWalkRow(walkClean);
      expect((yield* ledger.held([walkClean])).length).toBe(1);
      const ref = execution('exec-walk-clean');
      const floor = yield* floorOver(startedHost(ref, {}));
      yield* started(floor, 'op-walk-clean', walkClean);
      expect(yield* dischargedWith(floor, ref, receiptFor(ref))).toEqual({ _tag: 'Discharged' } as never);
      expect((yield* walkEnding(walkClean))._tag).toBe('Success');
    }),
  );

  it.effect('an interactive start mints the starter grant at accept', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-starter');
      const binding = BindingId.make('binding-starter');
      const floor = yield* floorOver(
        startedHost(ref, {
          openBinding: () => Effect.succeed({ _tag: 'Bound' as const, binding, principal: asHolder, epoch: 1 }),
        }),
      );
      const receipt = yield* Effect.scoped(
        floor.terminals.start({
          ...(yield* startOf('op-starter')),
          interactive: { revision: TERMINAL_PERMISSION_REVISION, runId: 'run-starter' },
        }),
      );
      expect(receipt._tag).toBe('Started');
      const standing = floor.grants.over(projectId, ref);
      expect(standing).toHaveLength(1);
      expect(standing[0]).toMatchObject({ binding, permissionRevision: TERMINAL_PERMISSION_REVISION, runId: 'run-starter' });
      expect(
        yield* floor.grants.evidence({
          projectId,
          execution: ref,
          actor: asHolder,
          binding,
          targetKey,
          permissionRevision: TERMINAL_PERMISSION_REVISION,
          runId: 'run-starter',
        }),
      ).toMatchObject({ binding });
    }),
  );

  it.effect('a start without the marker runs bare', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-bare');
      const host = startedHost(ref, {});
      const floor = yield* floorOver(host);
      expect((yield* started(floor, 'op-bare'))._tag).toBe('Started');
      expect(floor.grants.over(projectId, ref)).toEqual([]);
      expect(host.asked()['openBinding']).toBeUndefined();
      expect(host.asked()['custody']).toBeUndefined();
    }),
  );

  it.effect('an accept whose starter lane the host will not open answers the execution it started, with no lane and no grant', () =>
    Effect.gen(function* () {
      const { projectId } = yield* Fixture;
      const ref = execution('exec-no-take');
      const floor = yield* floorOver(
        startedHost(ref, {
          openBinding: () =>
            Effect.succeed({
              _tag: 'Refused' as const,
              operation: { installation, operation: HostRequestKey.make('op-no-take') },
              refusal: { _tag: 'Unauthorized' as const, reason: 'no key for this role' },
            }),
        }),
      );
      const receipt = yield* Effect.scoped(
        floor.terminals.start({ ...(yield* startOf('op-no-take')), interactive: { revision: TERMINAL_PERMISSION_REVISION } }),
      );
      expect(receipt).toMatchObject({ _tag: 'Started', record: { execution: ref }, binding: undefined });
      expect(floor.grants.over(projectId, ref)).toEqual([]);
    }),
  );

  it.effect('the product port types under a live lane grant', () =>
    Effect.gen(function* () {
      const ref = execution('exec-port-spends');
      const host = startedHost(ref, {
        input: () =>
          Effect.succeed({
            _tag: 'InputAdmitted' as const,
            receipt: { execution: ref, sequence: 0, cause: 'typed' as const, bytes: 2, acceptedThrough: ByteOffset.make('2') },
          }),
      });
      const floor = yield* floorOver(host);
      yield* started(floor, 'op-port-spend');
      yield* settled(floor, ref);
      const port = yield* portOf(floor.terminals, host);
      const outcome = yield* port.input(
        ref,
        { binding: BindingId.make('binding-3'), principal: asHolder },
        { sequence: 0, cause: 'typed' as const, act: { _tag: 'Write' as const, bytes: new Uint8Array([104, 105]) } },
      );
      expect(outcome._tag).toBe('InputAdmitted');
    }),
  );

  it.effect('the product port refuses input with no live grant', () =>
    Effect.gen(function* () {
      const ref = execution('exec-port-bare');
      const host = startedHost(ref, {});
      const floor = yield* floorOver(host);
      yield* started(floor, 'op-port-bare');
      const port = yield* portOf(floor.terminals, host);
      const outcome = yield* Effect.result(
        port.input(
          ref,
          { binding: BindingId.make('binding-3'), principal: asHolder },
          { sequence: 0, cause: 'typed' as const, act: { _tag: 'Write' as const, bytes: new Uint8Array([104, 105]) } },
        ),
      );
      expect(outcome._tag === 'Failure' && outcome.failure._tag === 'HostRefused' ? outcome.failure.refusal._tag : outcome._tag).toBe(
        'InputFenced',
      );
    }),
  );
});
