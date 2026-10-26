import { hostname } from 'node:os';
import { Deferred, Effect, FileSystem, Option, Path, Ref, Scope, Semaphore } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { CancellationCause } from '@runlith/executions/protocol/call';
import { type LimitProvenance } from '@runlith/executions/protocol/command';
import { ExecutionId, type ExecutionRef, type ExecutionState, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type InputProfile } from '@runlith/executions/protocol/inputProfile';
import { type LaunchRequest, type NativeProcess } from '@runlith/executions/protocol/launch';
import { type ShutdownAnswer, type StopAction } from '@runlith/executions/protocol/stop';
import { type ExecutionSummary, type QuiescenceTicket } from '@runlith/executions/protocol/runtime';
import { Bindings } from '../Bindings';
import { Custodian } from '../Custodian';
import { type ConnectionId, type CustodianEpoch, type Role } from '@runlith/executions/protocol/registration';
import { ExecutionCapacity } from '../ExecutionCapacity';
import type { Execution } from '../Execution';
import { ExecutionStore } from '../store/ExecutionStore';
import { HostAdmission } from '../HostAdmission';
import { type CallLifetimes, makeCallLifetimes } from '../CallLifetimes';
import { ExecutionUnknown } from '../executionFailures';
import { makeRecordShelf } from '../RecordShelf';
import { type HistoryReclaim, makeHistoryReclaim } from '../HistoryReclaim';
import { Holdings } from '../Holdings';
import { type VolumeReader } from '../RecordVolume';
import { type EvidenceScope } from '@runlith/executions/protocol/evidence';
import { Processes } from '../ProcessReader';
import { PlatformFacts } from '../PlatformFacts';
import { ProcessControl } from '../ProcessControl';
import { Holder } from '../holder/Holder';
import type { HolderLoss, UnadoptedExecution } from '@runlith/executions/protocol/runtime';
import { type NativeExecution } from '../nativeLaunch';
import { type ProcessWatch, makeProcessWatch } from '../ProcessWatch';
import { type Pacing, makePacing } from '../Pacing';
import { type ProcessTables, makeProcessTables } from '../ProvenSet';
import { makeResiduals, type Residuals } from '../Residuals';

const DEPARTURES_KEPT = 4_096;

export const PIPE_MODES: InputProfile = {
  _tag: 'Unavailable',
  revision: 0,
  reason: 'this execution runs on pipes, which have no terminal modes',
};

export type CommandLaunch = Extract<LaunchRequest, { readonly lifetime: 'command' }>;

export type Live = {
  readonly ref: ExecutionRef;
  readonly execution: Execution;
  readonly scope: Scope.Closeable;
  readonly close: Effect.Effect<void>;
  readonly native: NativeExecution;
  readonly operation: HostRequestRef;
  readonly state: Ref.Ref<ExecutionState>;
  readonly process: Ref.Ref<NativeProcess>;
  readonly reading: Ref.Ref<Reading>;
  readonly changed: Ref.Ref<Deferred.Deferred<void>>;
  readonly worked: Deferred.Deferred<void>;
  readonly stopReading: Effect.Effect<void>;
};

export type Reading = {
  readonly fenced: boolean;
  readonly reads: number;
  readonly readers: number;
  readonly settled: Deferred.Deferred<void> | undefined;
};

type Orphan = {
  readonly ref: ExecutionRef;
  readonly scope: Scope.Closeable;
  readonly native: NativeExecution;
  readonly operation: HostRequestRef;
  readonly reason: string;
};

export type ShutdownKeys = {
  readonly done: ReadonlyMap<string, ShutdownAnswer>;
  readonly live: ReadonlyMap<string, Deferred.Deferred<ShutdownAnswer>>;
};

export type AcceptedEnding = { readonly cause: CancellationCause; readonly trigger: string };

export type AcceptedGate = 'queued' | 'acquiring' | 'ended';

export type AcceptedAsk = { readonly operation: HostRequestRef; readonly action: StopAction };

export type Accepted = {
  readonly ref: ExecutionRef;
  readonly operation: HostRequestRef;
  readonly launch: CommandLaunch;
  readonly gate: Ref.Ref<AcceptedGate>;
  readonly ended: Deferred.Deferred<AcceptedEnding>;
  readonly allowance: Ref.Ref<Allowance>;
  readonly revising: Semaphore.Semaphore;
};

export type Allowance = {
  readonly executionMs: number | undefined;
  readonly ceilingMs: number | undefined;
  readonly origin: LimitProvenance;
  readonly foregroundMs: number | undefined;
  readonly revision: number;
};

export type HostClaim = {
  readonly connection: ConnectionId;
  readonly epoch: CustodianEpoch;
  readonly role: Role;
};

type Command = 'start' | 'end';

type Quiescence = { readonly ticket: QuiescenceTicket; readonly operation: HostRequestRef };

export const openState = Effect.fnUntraced(function* ({ volumeOf }: { readonly volumeOf: VolumeReader }) {
  const holder = yield* Holder;
  const store = yield* ExecutionStore;
  const admission = yield* HostAdmission;
  const custodian = yield* Custodian;
  const bindings = yield* Bindings;
  const capacity = yield* ExecutionCapacity;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* PlatformFacts;
  const control = yield* ProcessControl;
  const strays = Option.getOrUndefined(yield* Effect.serviceOption(Processes));
  const residuals = yield* makeResiduals;
  const tables = strays === undefined ? undefined : yield* makeProcessTables().pipe(Effect.provideService(Processes, strays));
  const watch = tables === undefined ? undefined : yield* makeProcessWatch({ tables });
  const pacing = yield* makePacing({ tables });
  if (watch !== undefined) yield* watch.follow(pacing.follow);
  const calls = yield* makeCallLifetimes;
  const registryScope = yield* Effect.scope;
  const reclaim = yield* makeHistoryReclaim;
  const held = new Holdings<Live>(DEPARTURES_KEPT);
  const orphans = yield* Ref.make<ReadonlyMap<ExecutionId, Orphan>>(new Map());
  const queued = yield* Ref.make<ReadonlyMap<ExecutionId, Accepted>>(new Map());
  const shutdowns = yield* Ref.make<ShutdownKeys>({ done: new Map(), live: new Map() });
  const inventoryWake = yield* Ref.make(Deferred.makeUnsafe<void>());
  const inventoryWoken = Effect.suspend(() =>
    Effect.flatMap(Ref.getAndSet(inventoryWake, Deferred.makeUnsafe<void>()), (standing) =>
      Effect.asVoid(Deferred.succeed(standing, undefined)),
    ),
  );
  const cancelling = yield* Ref.make<
    ReadonlyMap<string, { readonly cause: CancellationCause; readonly trigger: string; readonly ask?: AcceptedAsk }>
  >(new Map());
  const quiescence = yield* Ref.make<Quiescence | undefined>(undefined);
  const localScope: EvidenceScope = {
    host: { _tag: 'Local', machine: hostname() },
    network: { _tag: 'Local', machine: hostname() },
  };
  const entered = yield* store.incarnation();
  const records = path.join(entered.registration.state, 'records');
  const limits = capacity.profile.execution;
  const shelf = yield* makeRecordShelf({
    current: entered,
    records,
    chunkBytes: limits.read.chunkBytes,
    pipeModes: PIPE_MODES,
    volumeOf,
    retired: (ref) => held.retired(ref),
    inventoryWoken,
  });
  const recounted = yield* Ref.make<number | undefined>(undefined);
  const unadopted = yield* Ref.make<ReadonlyArray<UnadoptedExecution>>([]);
  const lost = yield* Ref.make<HolderLoss | undefined>(undefined);
  yield* Effect.forkIn(
    Effect.flatMap(holder.lost, (loss) => Ref.set(lost, loss)),
    registryScope,
  );
  return {
    lost,
    store,
    admission,
    custodian,
    bindings,
    capacity,
    fs,
    path,
    spawner,
    platform,
    holder,
    strays,
    control,
    residuals,
    tables,
    watch,
    pacing,
    calls,
    registryScope,
    reclaim,
    held,
    orphans,
    queued,
    shutdowns,
    inventoryWake,
    inventoryWoken,
    cancelling,
    quiescence,
    localScope,
    entered,
    records,
    limits,
    shelf,
    recounted,
    unadopted,
  };
});

export type RegistryState = Effect.Success<ReturnType<typeof openState>>;

export const recordHandles = (registry: RegistryState) =>
  new Map(registry.held.all().map((found) => [found.ref.execution, found.execution.record.openHandles] as const));

export const inventoryMoved = (registry: RegistryState, execution?: ExecutionId): Effect.Effect<void> =>
  Effect.suspend(() => {
    registry.held.moved(execution);
    return registry.inventoryWoken;
  });

export const live = (registry: RegistryState, execution: ExecutionId): Effect.Effect<Live, ExecutionUnknown> => {
  const { held } = registry;
  return Effect.suspend(() => {
    const found = held.get(execution);
    return found === undefined ? Effect.fail(new ExecutionUnknown({ execution })) : Effect.succeed(found);
  });
};

export const moved = (registry: RegistryState, found: Live): Effect.Effect<void> => {
  const { held } = registry;
  return Effect.flatMap(Ref.getAndSet(found.changed, Deferred.makeUnsafe<void>()), (standing) =>
    Effect.andThen(
      Effect.sync(() => held.touched(found.ref.execution)),
      Effect.asVoid(Deferred.succeed(standing, undefined)),
    ),
  );
};

export const summaryOf = Effect.fnUntraced(function* (registry: RegistryState, found: Live) {
  const { calls } = registry;
  const decision = yield* calls.decision(found.operation).pipe(Effect.catchTag('CallMissing', () => Effect.succeed(undefined)));
  const state = yield* Ref.get(found.state);
  const native = yield* Ref.get(found.process);
  const cost = state.nativeExit === undefined ? undefined : yield* found.native.cost;
  return yield* found.execution.summary(state, native, cost, decision);
});

export const commanding = (registry: RegistryState, claim: HostClaim, command: Command) => {
  const { custodian } = registry;
  return claim.role === 'recovery' && command === 'end'
    ? Effect.succeed(undefined)
    : Effect.asVoid(custodian.check(claim.epoch, claim.connection));
};
