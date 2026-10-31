import { availableParallelism, totalmem } from 'node:os';
import { Data, Clock, Deferred, Effect, Layer, Path, Stream } from 'effect';
import { type CapabilityProfile, ExecutionPolicy, grantOf, reserveOf } from '@runlith/executions/protocol/capacity';
import type { Capability, Served } from '@runlith/executions/protocol/capability';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { Registration } from '@runlith/executions/protocol/registration';
import { WireLimits } from '@runlith/executions/protocol/wire';
import { boundTo, identityOf, stampOf, verifyArtifact } from '@runlith/executions/hostArtifacts';
import { pipeCapability } from './nativeLaunch';
import { HostRegistration, type RegistrationReadFailure } from '@runlith/executions/HostRegistration';
import { answer } from './answers';
import { Bindings } from './Bindings';
import { YieldRequests } from './YieldRequests';
import { Custodian } from './Custodian';
import { ExecutionCapacity } from './ExecutionCapacity';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { Executions } from './registry/launch';
import { ExecutionRequest } from './registry/operations';
import { HostCommands, HostProcessFacts } from './registry/inventory';
import { CustodyControl, InputLanes, PaceControl } from './registry/control';
import { ExecutionStop } from './registry/stops';
import { HostByteRecords, TerminalScreen } from './registry/reads';
import { ExecutionRetirement, HostDisown } from './registry/retention';
import { HostLifecycle } from './registry/shutdown';
import { ExecutionStore } from './store/ExecutionStore';
import { HostAdmission } from './HostAdmission';
import { HostConnections } from './HostConnections';
import { PlatformFacts } from './PlatformFacts';
import { kernelClock } from './KernelClock';
import { Processes } from './ProcessReader';
import { EvidenceReader, type EvidenceScans, makeEvidenceScans } from './EvidenceScans';
import { hostState } from './hostState';
import { hostSpawner } from './hostSpawner';
import { ACTIVATE_EXIT, Holder } from './holder/Holder';
import { type HostTelemetryOptions, hostTelemetry, reportDeadFiber } from './hostTelemetry';
import { makeProcessEvidence, type ExecutionTopology } from './ProcessEvidence';
import { type ProcessUsage, makeProcessUsage } from './ProcessUsage';
import { UsageSource, type UsageReader } from './UsageReader';
import type { HostLifetime } from '@runlith/executions/protocol/boot';
import { RECORDS_DIRECTORY } from '@runlith/executions/recordFormat';
import { upgradeRecords } from './RecordUpgrade';
import { BootRefused } from './boot';
import { childHosting } from '@runlith/sqlite-process/children';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';

const under = (state: string, named: string): boolean => {
  const root = state.endsWith('/') ? state : `${state}/`;
  return (
    named.startsWith(root) &&
    named
      .slice(root.length)
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
};

export type HostInput = {
  readonly state: string;
  readonly registration: Registration;
  readonly library: string;
  readonly policy: ExecutionPolicy;
  readonly share: number;
  readonly limits: WireLimits;
  readonly lifetime?: HostLifetime;
  readonly artifact?: string;
};

const EVIDENCE_ROW_BYTES = 600;

export const DATABASE_FILE = 'executions.sqlite';

export const readyLine = (registration: Registration): string =>
  `${registration.protocol} ${registration.state} ${registration.endpoint.path}`;

export const host = Effect.fnUntraced(function* (input: HostInput) {
  const path = yield* Path.Path;
  const registrations = yield* HostRegistration;

  const verified =
    input.artifact === undefined
      ? undefined
      : yield* verifyArtifact(input.artifact).pipe(
          Effect.catchTag('ArtifactMissing', (error) =>
            Effect.fail(new BootRefused({ detail: `no artifact manifest stands in ${error.root}` })),
          ),
          Effect.catchTag('ArtifactInvalid', (error) =>
            Effect.fail(
              new BootRefused({
                detail:
                  error.reason === 'mismatch'
                    ? `${error.path}: expected ${error.expected} and found ${error.found}`
                    : `${error.root}: ${error.detail}`,
              }),
            ),
          ),
          Effect.catchTag('ArtifactUnreadable', (error) => Effect.fail(new BootRefused({ detail: `${error.path}: ${error.detail}` }))),
        );
  if (verified !== undefined) {
    if (verified.commands !== undefined && identityOf({ ...verified, commands: [pipeCapability] }) !== verified.identity.digest) {
      return yield* new BootRefused({ detail: 'the artifact command capabilities do not match this host backend' });
    }
  }
  if (input.artifact !== undefined && verified !== undefined) {
    const root = input.artifact;
    for (const [role, used] of [
      ['runtime', process.execPath],
      ['host', Bun.main],
      ['platform', input.library],
    ] as const) {
      if (!(yield* boundTo(root, verified, role, used).pipe(Effect.mapError((error) => new BootRefused({ detail: error.detail }))))) {
        return yield* new BootRefused({
          detail: `${used} is not the ${role} part this bundle pins; the artifact would name bytes this host is not running`,
        });
      }
    }
  }
  const facts = yield* PlatformFacts;
  const granted = grantOf(input.share, totalmem());
  const platform = yield* facts.limits.pipe(
    Effect.catchTag('LimitsUnreadable', (error) =>
      Effect.fail(new BootRefused({ detail: `this kernel did not answer its own limits: ${error.detail}` })),
    ),
  );
  const machine = { granted, descriptors: ExecutionCapacity.descriptors(input.policy, facts.descriptors), limits: platform };
  const reserve = reserveOf(input.policy.execution, input.policy.transports.includes('pty') ? 'pty' : 'pipes');
  if (granted.grantBytes < reserve) {
    return yield* new BootRefused({
      detail: `a ${input.share} share of ${granted.machineBytes} bytes grants ${granted.grantBytes}, and one execution reserves ${reserve}`,
    });
  }
  const profile = yield* ExecutionCapacity.profile(input.policy, facts.identity, machine);
  const account = yield* Layer.build(ExecutionCapacity.forHost(profile, facts.identity));

  for (const named of [
    input.registration.endpoint.path,
    input.registration.credentials.custodian,
    input.registration.credentials.recovery,
  ]) {
    if (!under(input.state, named)) {
      return yield* new BootRefused({ detail: `${named} is named outside the state directory ${input.state}` });
    }
  }

  const publication = yield* registrations.publish(input.state, {
    installation: input.registration.installation,
    protocol: input.registration.protocol,
    endpoint: input.registration.endpoint,
    credentials: input.registration.credentials,
  });
  const registration = publication.registration;

  let witness: Effect.Effect<void, RegistrationReadFailure> = Effect.void;
  if (verified !== undefined) {
    const logic = (yield* Processes).identity(process.pid);
    if (logic._tag !== 'Read') {
      return yield* new BootRefused({
        detail: `this logic cannot read its own process birth: ${logic._tag === 'Gone' ? 'gone' : logic.detail}`,
      });
    }
    witness = Effect.asVoid(registrations.record(registration.state, stampOf(verified), { pid: logic.pid, birth: logic.birth }));
  }

  yield* upgradeRecords({ records: path.join(registration.state, RECORDS_DIRECTORY) });

  const state = yield* Layer.build(
    hostState(path.join(registration.state, DATABASE_FILE), registration, new ProcessPool(undefined, 'stop', undefined, childHosting)).pipe(
      Layer.provide(Layer.succeedContext(account)),
    ),
  );
  const entered = yield* Effect.provide(
    Effect.flatMap(ExecutionStore, (store) => store.incarnation()),
    Layer.succeedContext(state),
  );

  return {
    registration,
    witness,
    profile,
    incarnation: entered.incarnation,
    owners: Layer.succeedContext(state).pipe(Layer.merge(Layer.succeedContext(account))),
  } as const;
});

export const serve = (input: HostInput, options?: { readonly telemetry?: HostTelemetryOptions }) =>
  Effect.flatMap(PlatformFacts, (facts) =>
    Effect.flatMap(kernelClock(facts.uptimeNanos), (clock) => Effect.provideService(serving(input, options), Clock.Clock, clock)),
  );

const serving = Effect.fnUntraced(function* (input: HostInput, options?: { readonly telemetry?: HostTelemetryOptions }) {
  const built = yield* host(input);
  const capacity = yield* Effect.provide(ExecutionCapacity, built.owners);
  const limits: WireLimits = {
    ...input.limits,
    get subscriptions() {
      return capacity.profile.ceilings.readers;
    },
  };
  const native = yield* openUsage;
  yield* Processes;
  const served = new Set<Capability>();
  const connections = HostConnections.layer(built.registration, built.incarnation, limits, served).pipe(Layer.provide(built.owners));
  const bindings = Bindings.layer.pipe(Layer.provide(built.owners));
  const registry = ExecutionRegistry.layer().pipe(Layer.provideMerge(bindings), Layer.provide(hostSpawner), Layer.provide(built.owners));
  const serving = Layer.mergeAll(registry, connections, built.owners, hostSpawner);
  const answering = loop(
    built.registration,
    built.witness,
    native,
    Math.min(built.profile.execution.read.chunkBytes, built.profile.execution.read.readerCredits),
    built.incarnation,
    limits,
    served,
  );
  const running = Effect.raceFirst(
    answering,
    Effect.flatMap(HostLifecycle, (lifecycle) => lifecycle.orphaned),
  );
  return yield* Effect.provide(
    input.lifetime === 'with-parent' ? Effect.raceFirst(running, parentGone).pipe(Effect.ensuring(vacated(built.registration))) : running,
    options?.telemetry === undefined ? serving : Layer.mergeAll(serving, hostTelemetry(built.registration.state, options.telemetry)),
  );
});

type Measuring = { readonly scans: EvidenceScans; readonly native: UsageReader | undefined } | undefined;

const servedBy = (profile: CapabilityProfile, measured: Measuring, platform: ReadonlyArray<Capability>): Served =>
  new Set<Capability>([
    ...platform,
    'end-residual',
    'screen-point',
    'screen-settled',
    ...(profile.usage !== undefined && measured?.native !== undefined
      ? [
          'machine-load' as const,
          'machine-load-parts' as const,
          'machine-load-gpu' as const,
          'machine-load-roles' as const,
          'end-process' as const,
        ]
      : []),
  ]);

const ENVELOPE_BYTES = 4096;

const openUsage = Effect.flatMap(UsageSource, (usage) => usage.open).pipe(
  Effect.catchTag('UsageUnavailable', (failure) => Effect.as(Effect.logWarning(`native usage unavailable: ${failure.detail}`), undefined)),
);

const measuring = (
  profile: CapabilityProfile,
  limits: WireLimits,
  native: UsageReader | undefined,
): Effect.Effect<Measuring, never, EvidenceReader> =>
  makeEvidenceScans({
    limits: {
      concurrency: 3,
      flight: limits.connections * limits.requests,
      freshMs: 1_000,
      retained: Math.max(...profile.transports.map((transport) => profile.ceilings.perTransport[transport])),
      results: Math.max(
        1,
        Math.trunc(
          (limits.frameBytes -
            Math.max(profile.execution.read.chunkBytes, profile.execution.input.chunkBytes, profile.execution.frame.bytes)) /
            EVIDENCE_ROW_BYTES,
        ),
      ),
    },
  }).pipe(
    Effect.map((scans) => ({ scans, native })),
    Effect.catchTag('ScanLimitsRefused', (failure) =>
      Effect.as(Effect.logWarning('native evidence scans unavailable', failure), undefined),
    ),
  );

const placement = (facts: HostProcessFacts['Service']): ExecutionTopology => ({
  of: facts.topology,
  watching: facts.watched(),
  ended: facts.ended(),
  residuals: facts.residuals(),
  dropResiduals: facts.dropResiduals,
});

const sampling = Effect.fnUntraced(function* (
  profile: CapabilityProfile,
  measured: Measuring,
  budgetBytes: number,
): Effect.fn.Return<ProcessUsage | undefined, never, HostProcessFacts | Holder | Processes> {
  const policy = profile.usage;
  if (policy === undefined || measured?.native === undefined) return undefined;
  const facts = yield* HostProcessFacts;
  const holder = yield* Holder;
  return yield* makeProcessUsage({
    topology: placement(facts),
    scope: measured.scans.scope,
    policy,
    native: measured.native,
    hostPid: process.pid,
    cores: availableParallelism(),
    budgetBytes,
    holderPid: holder.pid,
  }).pipe(
    Effect.catchTag('UsageUnreadable', (failure) => Effect.as(Effect.logWarning('native usage sampling unavailable', failure), undefined)),
  );
});

class ParentPipeBroken extends Data.TaggedError('ParentPipeBroken')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

const parentGone: Effect.Effect<void> = Stream.runDrain(
  Stream.fromReadableStream<Uint8Array, ParentPipeBroken>({
    evaluate: () => Bun.stdin.stream(),
    onError: (error) => new ParentPipeBroken({ detail: String(error) }),
  }),
).pipe(Effect.catchTag('ParentPipeBroken', (broken) => Effect.logInfo(`the parent's pipe broke: ${broken.detail}`)));

const vacated = Effect.fnUntraced(function* (registration: Registration): Effect.fn.Return<void, never, HostLifecycle | Holder> {
  const lifecycle = yield* HostLifecycle;
  yield* lifecycle.vacate({ installation: registration.installation, operation: HostRequestKey.make(`vacate:${crypto.randomUUID()}`) });
  yield* (yield* Holder).vacate.pipe(
    Effect.catchTag('HolderRefused', (failure) =>
      failure.reason === 'lost' ? Effect.void : Effect.logWarning(`the holder was not told to end what it still holds: ${failure.detail}`),
    ),
  );
});

const loop = Effect.fnUntraced(function* (
  registration: Registration,
  witness: Effect.Effect<void, RegistrationReadFailure>,
  native: UsageReader | undefined,
  chunk: number,
  incarnation: number,
  limits: WireLimits,
  served: Set<Capability>,
) {
  const connections = yield* HostConnections;
  const executions = yield* Executions;
  const requests = yield* ExecutionRequest;
  const commands = yield* HostCommands;
  const lanes = yield* InputLanes;
  const custody = yield* CustodyControl;
  const stops = yield* ExecutionStop;
  const records = yield* HostByteRecords;
  const screens = yield* TerminalScreen;
  const retirement = yield* ExecutionRetirement;
  const lifecycle = yield* HostLifecycle;
  const pacing = yield* PaceControl;
  const disowning = yield* HostDisown;
  const bindings = yield* Bindings;
  const custodian = yield* Custodian;
  const capacity = yield* ExecutionCapacity;
  const facts = yield* PlatformFacts;
  yield* capacity.connections(connections.descriptorReserve);
  yield* capacity.initialize(facts, records.openHandles).pipe(
    Effect.catchTags({
      LimitsUnreadable: (error) => Effect.fail(new BootRefused({ detail: error.detail })),
      StandingUnreadable: (error) => Effect.fail(new BootRefused({ detail: `${error.region}: ${error.detail}` })),
    }),
    Effect.catchTag('ProfileInvalid', (refused) =>
      Effect.andThen(
        Effect.flatMap(HostRegistration, (registrations) => registrations.withdraw(registration)),
        Effect.fail(refused),
      ),
    ),
  );
  const profile = capacity.profile;
  const budgetBytes = Math.max(ENVELOPE_BYTES, limits.headerBytes - ENVELOPE_BYTES);
  const measured = yield* measuring(profile, limits, native);
  for (const capability of servedBy(profile, measured, [...(yield* Holder).capabilities])) served.add(capability);
  yield* witness;
  yield* connections.open;
  yield* Effect.forkScoped(Effect.andThen(lifecycle.leaving, connections.close));
  yield* Effect.forkScoped(
    Effect.flatMap(lifecycle.departed, (unannounced) => Effect.sync(() => process.exit(unannounced ? ACTIVATE_EXIT : 0))),
  );
  yield* Effect.forkScoped(Stream.runForEach((yield* YieldRequests).asked, () => lifecycle.askedToYield));
  const admission = yield* HostAdmission;
  const processFacts = yield* HostProcessFacts;
  const evidence =
    measured === undefined ? undefined : yield* makeProcessEvidence({ topology: placement(processFacts), scans: measured.scans });
  const usage = yield* sampling(profile, measured, budgetBytes);
  if (usage !== undefined) yield* Effect.forkScoped(reportDeadFiber('usage-sampler', usage.sampling));
  yield* Effect.log(readyLine(registration));
  yield* (yield* Holder).ready.pipe(
    Effect.catchTag('HolderRefused', (failure) => Effect.logWarning(`the holder was not told this logic is ready: ${failure.detail}`)),
  );
  const over = yield* Deferred.make<void>();
  const closed = Effect.flatMap(admission.phase(), (phase) =>
    phase === 'closed' ? Effect.asVoid(Deferred.succeed(over, undefined)) : Effect.void,
  );
  yield* Effect.raceFirst(
    Effect.forever(
      Effect.gen(function* () {
        const admitted = yield* connections.admitted;
        const answering = Effect.ensuring(
          Effect.asVoid(
            reportDeadFiber(
              'answer',
              answer(
                executions,
                requests,
                commands,
                processFacts,
                lanes,
                custody,
                stops,
                records,
                screens,
                retirement,
                lifecycle,
                pacing,
                disowning,
                bindings,
                custodian,
                capacity,
                admission,
                evidence,
                usage,
                admitted,
                chunk,
                incarnation,
                registration.installation,
              ),
            ),
          ),
          closed,
        );
        yield* Effect.forkScoped(admitted.parent === undefined ? answering : Effect.withParentSpan(answering, admitted.parent));
      }),
    ),
    Deferred.await(over),
  );
});
