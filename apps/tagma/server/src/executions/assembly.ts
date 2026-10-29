import type { EndpointConnection } from '@runlith/executions/EndpointConnection';
import { custodyNotice } from './store/terminal.js';
import { makeExecutionHistory } from './store/history.js';
import { ExecutionHistory } from './contract/service/history.js';

import { SessionIdentity } from '../platform/contract/wire/session.js';

import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  PubSub,
  Queue,
  Ref,
  Scope,
  Stream,
} from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress, type HostAddressInvalid } from '@runlith/executions/hostAddress';
import type { BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { Settings } from '../settings/contract/service/values.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { drive } from '../platform/contract/service/drives.js';
import { writes } from '../platform/contract/service/writes.js';
import { shippedChain } from '../platform/store/chain.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { HostPace } from '../power/contract/service/pace.js';
import { SuccessionSteps } from '../installation/contract/service/steps.js';
import type { NoticeTakeBack } from './contract/service/notices.js';
import { TerminalGrids, ViewLanes, ViewLeases } from './contract/service/views.js';
import { HostManagement, type HostStanding } from './contract/service/host.js';
import { MachineHost } from '../installation/contract/service/machineHost.js';
import { makeMachineHost } from './host/machineHost.js';
import { hostMemoryShare } from './contract/wire/terminalBehavior.js';
import { TerminalUnavailable } from './contract/wire/refusals.js';
import type { TerminalRecord } from './contract/wire/terminals.js';
import type { ViewId } from './contract/wire/viewLeases.js';
import { executionPolicy } from './host/policy.js';
import { executionHandshakeMs } from './contract/wire/terminalBehavior.js';
import { Environments } from '../workspace/contract/service/environments.js';
import { Coverage, FileRoots, RootUses } from '../workspace/contract/service/roots.js';
import { makeViewLeaseBook } from './terminals/viewLeases.js';
import { executionHost, executionState, hostServices } from './host/connection.js';
import { makeTerminalAccess } from './terminals/access.js';
import { makeCommandAccess } from './commands/access.js';
import { makeCommandFeed } from './commands/feed.js';
import { makeCommandOutput } from './commands/output.js';
import { makeOutputSearch } from './commands/search.js';
import type { RipgrepBinary } from '../platform/contract/service/ripgrep.js';
import type { ChildProcessSpawner } from 'effect/process';
import { makeStoredCommands } from './commands/reader.js';
import { makeCommandWaiters, TakeBackOpening } from './commands/waiters.js';
import { CommandAccess, TerminalAccess } from './contract/service/access.js';
import { CommandReader, CommandWaiters } from './contract/service/commands.js';
import { TerminalGrants } from './contract/service/grants.js';
import { ServingGit } from './contract/service/git.js';
import { TerminalTargets } from './contract/service/targets.js';
import { ThreadLineage } from '../workspace/contract/service/assignments.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { makeTerminalEndings } from './terminals/endings.js';
import type { TerminalWatched } from './contract/service/endings.js';
import { makeTerminalGrants } from './terminals/grantBook.js';
import { makeTerminalHostCustody, detailOf, type CustodyAssurance } from './host/custody.js';
import { carriedOffer, hostBundleNext, hostOffer, swapBundle, withdrawCandidate } from './host/offer.js';
import { prepareChange, weighBundle, yieldPlace } from './host/departure.js';
import { awaitLogic } from './host/arrival.js';
import { placeOverForeign, standingAfter } from './host/foreign.js';
import { endStanding, firstEnable } from './host/firstEnable.js';
import { shutdownMsOf } from '@runlith/executions/protocol/capacity';
import {
  holdHostShare,
  hostBundle,
  signalClaimHolder,
  stateClaim,
  hostBootDetail,
  hostPresence,
  hostRaisable,
  raiseHost,
  type HostBoot,
} from './host/boot.js';
import { makeTerminalReconciliation, TerminalReconciliation } from './terminals/reconciliation.js';
import { makeExecutionGrids, InputWitness } from './terminals/gridControl.js';
import { makeTerminalWriters, TerminalWriters } from './terminals/writers.js';
import { makeTerminalLanes } from './terminals/lanes.js';
import { makeServingGit } from './commands/servingGit.js';
import { runRetention } from './terminals/retention.js';
import { Custody, type TerminalDisplaced } from './contract/service/custody.js';
import { Discharge } from './contract/service/discharge.js';
import { ClaimHolders, ExecutionHost, type HostOffer, HostOffering, type HostPlacement, LogicYield } from './contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from './contract/service/records.js';
import { ManagedCommands } from './contract/service/commands.js';
import { TerminalRequests, Terminals } from './contract/service/terminals.js';
import { TerminalWriting } from './contract/service/writing.js';
import { makeHostTerminals } from './terminals/hostTerminals.js';
import { makeTerminalInventory, TerminalInventory } from './terminals/inventory.js';
import { makeRequestKeys, RequestKeys } from './store/requestKeys.js';
import { makeTerminalIntents, TerminalIntents } from './store/intentLifecycle.js';
import { makeTerminalRows, replacedNoticeId, TerminalRows } from './store/terminalRows.js';
import { makeCommandRows, CommandRows } from './store/commandRows.js';
import { makeCommandDeliveries, CommandDeliveries } from './store/deliveries.js';
import { currentRules } from './store/standingRules.js';
import { makeTerminalTargets } from './terminals/targets.js';
import { makeTerminalThreads } from './terminals/threads.js';
import { ServedRoots } from '../browser/contract/service/sources.js';
import { makeServedRoots } from './servedRoots.js';

export type ExecutionsUnavailable = HostAddressInvalid | TerminalUnavailable;

export const retainRequestKeys = (units: MachineUnits['Service'], requestKeys: RequestKeys, moment: string): Effect.Effect<void> =>
  Effect.flatMap(Clock.currentTimeMillis, (now) => runRetention(units, requestKeys, now)).pipe(
    Effect.asVoid,
    Effect.catch((cause) =>
      Effect.logWarning(
        `terminal key retention could not run (${moment})`,
        cause._tag === 'TerminalRefused' ? { reason: cause.reason } : { owner: cause.owner },
      ),
    ),
  );

const heldByThreads = (
  units: MachineUnits['Service'],
  terminalRows: TerminalRows,
): Effect.Effect<readonly TerminalRecord[], TerminalUnavailable> =>
  units
    .read((unit) => terminalRows.held(unit))
    .pipe(
      Effect.mapError(
        (failure) =>
          new TerminalUnavailable({
            owner: 'store',
            message: `The terminals threads hold could not be read before ending the standing execution host (${failure._tag}).`,
          }),
      ),
    );

const tellReplaced = (
  units: MachineUnits['Service'],
  terminalRows: TerminalRows,
  displaced: Queue.Enqueue<TerminalDisplaced>,
  held: readonly TerminalRecord[],
): Effect.Effect<void, TerminalUnavailable> =>
  held.length === 0
    ? Effect.void
    : Effect.flatMap(Clock.currentTimeMillis, (now) =>
        units
          .write(writes('executionsLayer.tellReplaced', [custodyNotice]), (unit) => terminalRows.noticeReplaced(unit, held, now))
          .pipe(
            Effect.andThen(
              Queue.offer(displaced, {
                projectId: held[0]!.projectId,
                operationId: replacedNoticeId(held[0]!.execution),
              }),
            ),
            Effect.asVoid,
            Effect.mapError(
              (failure) =>
                new TerminalUnavailable({
                  owner: 'store',
                  message: `The threads whose terminals ended with the execution host this server ended could not be owed a notice (${failure._tag}; ${held.length} terminals).`,
                }),
            ),
          ),
      );

import { TerminalEndings } from './contract/service/endings.js';

export type ExecutionServices =
  | TerminalEndings
  | Terminals
  | TerminalRequests
  | TerminalWriting
  | Custody
  | ManagedCommands
  | ExecutionRecords
  | TerminalScreens
  | ExecutionProcessEvidence
  | Discharge
  | ExecutionHost
  | TerminalAccess
  | CommandAccess
  | CommandReader
  | CommandWaiters
  | TakeBackOpening
  | TerminalGrants
  | TerminalTargets
  | ServingGit
  | HostPace
  | SuccessionSteps
  | HostManagement
  | MachineHost
  | ViewLeases
  | ViewLanes
  | TerminalGrids
  | ExecutionHistory
  | ServedRoots;

export const executionsLayer: Layer.Layer<
  ExecutionServices,
  ExecutionsUnavailable,
  | MachineStore
  | MachineUnits
  | Environments
  | FileRoots
  | RootUses
  | Coverage
  | CheckoutPaths
  | ThreadLineage
  | Settings
  | FileSystem.FileSystem
  | Path.Path
  | HostRegistration
  | EndpointConnection
  | SessionIdentity
  | HostOffering
  | LogicYield
  | ClaimHolders
  | RipgrepBinary
  | ChildProcessSpawner.ChildProcessSpawner
> = Layer.effectContext(
  Effect.gen(function* () {
    const { source, placed, replacing, migrations, programVersion, hostEnded, lifetime, takenAfter } = yield* HostOffering;
    const machine = yield* MachineStore;
    const { db, path, schema } = machine;
    const units = yield* MachineUnits;
    const environments = yield* Environments;
    const { identity } = yield* environments.inspect('host').pipe(
      Effect.mapError(
        (refusal) =>
          new TerminalUnavailable({
            owner: 'environment',
            message: `The environment registry could not name this installation's executions: ${refusal._tag}`,
          }),
      ),
    );
    const address = yield* hostAddress(executionState(path, identity.environmentId), identity.environmentId);
    const files = yield* FileSystem.FileSystem;
    const claim = stateClaim(yield* ClaimHolders, files, address.state);
    const bundle = hostBundle(address.state);
    const registrations = yield* HostRegistration;
    const coldRoad =
      placed === undefined && source !== undefined
        ? placeOverForeign({ files, registrations, source, state: address.state, claim, lifetime })
        : Effect.succeed(undefined);
    const cold = takenAfter === undefined ? yield* coldRoad : undefined;
    const placementOf = (cold: Effect.Success<typeof coldRoad>): HostPlacement | undefined =>
      cold?._tag === 'Foreign' ? cold.placed : (cold ?? placed);
    const placement = placementOf(cold);
    const offered = (placement: HostPlacement | undefined): Effect.Effect<HostOffer> =>
      placement !== undefined && placement._tag !== 'Vacant'
        ? Effect.succeed({ _tag: 'Offered', digest: placement.digest, detail: placement.detail })
        : source === undefined
          ? Effect.succeed({ _tag: 'Unoffered', detail: 'this installation has nothing to offer a host from' })
          : hostOffer({ files, state: address.state, source });
    const offer: HostOffer =
      takenAfter !== undefined && source !== undefined
        ? yield* carriedOffer({ files, state: address.state, source })
        : yield* offered(placement);
    const admitted = yield* Deferred.make<void>();
    const takenOver = yield* Deferred.make<void>();
    const host = yield* executionHost(
      { ...address, digest: offer._tag === 'Offered' ? offer.digest : null },
      takenAfter === undefined ? undefined : Deferred.await(admitted),
    );
    const executions = host.direct;
    type YieldStage = 'idle' | 'armed' | 'yielding';
    const yielding = yield* Ref.make<YieldStage>('idle');
    yield* Effect.addFinalizer(() =>
      Effect.flatMap(
        Ref.modify(yielding, (stage): [boolean, YieldStage] => (stage === 'armed' ? [true, 'yielding'] : [false, stage])),
        (armed) => (armed ? yieldPlace(executions, files, registrations, address.state, address.installation, claim) : Effect.void),
      ),
    );
    const swap = swapBundle(files, address.state, claim);
    const offering = Effect.map(hostRaisable(files, hostBundleNext(address.state)), (waiting) =>
      waiting ? hostBundleNext(address.state) : bundle,
    );
    const policy = executionPolicy;
    const terminalRows = makeTerminalRows({ db, installation: address.installation });
    const displaced = yield* Queue.unbounded<TerminalDisplaced>();
    const heldAtFence = yield* Ref.make<readonly TerminalRecord[]>([]);
    const yieldAsk = yield* LogicYield;
    const broughtUp = Effect.fnUntraced(function* (cold: Effect.Success<typeof coldRoad>, given: HostOffer) {
      const ending = {
        files,
        bundle,
        state: address.state,
        graceMs: shutdownMsOf(policy.shutdownMs),
        claim,
        signalClaim: signalClaimHolder,
        fence: heldByThreads(units, terminalRows).pipe(Effect.flatMap((held) => Ref.set(heldAtFence, held))),
        record: (ended: number | undefined, detail: string) => hostEnded?.(ended, detail) ?? Effect.void,
      };
      const first = yield* firstEnable(ending);
      if (first._tag === 'Enabled') {
        yield* tellReplaced(units, terminalRows, displaced, yield* Ref.get(heldAtFence)).pipe(Effect.orDie);
      }
      if (first._tag === 'Refused') yield* Effect.logWarning(first.detail);
      const arrival = yield* awaitLogic(
        {
          files,
          registrations,
          status: executions.status(),
          claim,
          ask: yieldAsk,
          state: address.state,
        },
        cold?._tag === 'Foreign' ? cold.placed : placed,
      );
      const replaced =
        replacing === true && (arrival._tag === 'Refused' || arrival._tag === 'Kept')
          ? yield* endStanding(ending, `the execution host of another build, which does not take this one (${arrival.detail})`)
          : undefined;
      if (replaced?._tag === 'Enabled') {
        yield* tellReplaced(units, terminalRows, displaced, yield* Ref.get(heldAtFence)).pipe(Effect.orDie);
      }
      if (replaced?._tag === 'Refused') yield* Effect.logWarning(replaced.detail);
      const stayed = replaced?._tag === 'Enabled' ? null : yield* standingAfter(arrival, files, address.state);
      if (stayed !== null) yield* Effect.logWarning(stayed);
      const raised: HostBoot =
        given._tag === 'Unoffered'
          ? { _tag: 'Unraised', reason: given.detail }
          : yield* raiseHost({ address: host.address, files, registrations, policy, status: executions.status(), claim, swap, lifetime });
      return { stayed, raised };
    });
    const brought = takenAfter === undefined ? yield* broughtUp(cold, offer) : undefined;
    const offeredOf = (bundle: string) =>
      offer._tag === 'Unoffered'
        ? undefined
        : { bundle, digest: offer.digest, database: schema, application: shippedChain(migrations), policy, lifetime };
    const requestKeys = makeRequestKeys({ db, installation: address.installation });
    const intents = makeTerminalIntents({ db, installation: address.installation, keys: requestKeys });
    const deliveries = makeCommandDeliveries({ db, installation: address.installation });
    const commandRows = makeCommandRows({ db, installation: address.installation, deliveries });
    const custody = yield* makeTerminalHostCustody({
      executions,
      served: host.port,
      welcome: host.welcome,
      installation: address.installation,
      state: address.state,
      offered: offeredOf(takenAfter === undefined ? yield* offering : bundle),
      ready: takenAfter === undefined ? undefined : Deferred.await(takenOver),
    });
    yield* Ref.set(host.opened, custody.opened);
    const floorDetail = (boot: HostBoot, assurance: CustodyAssurance, state: string): string =>
      assurance._tag === 'Held'
        ? hostBootDetail(boot)
        : `${hostBootDetail(boot)} This floor does not hold custody of it (${assurance.reason._tag}): ${detailOf(assurance.reason, state)}.`;
    const awaited: HostBoot = { _tag: 'Awaited' };
    const opening: HostStanding = {
      boot: awaited,
      custodian: false,
      detail: hostBootDetail(awaited),
      notice: hostBootDetail(awaited),
      geometry: policy.execution.geometry,
    };
    const live = yield* Ref.make<HostStanding>(opening);
    const standings = yield* Effect.acquireRelease(PubSub.sliding<HostStanding>({ capacity: 1, replay: 1 }), PubSub.shutdown);
    yield* PubSub.publish(standings, opening);
    const stand = (standing: HostStanding) => Effect.andThen(Ref.set(live, standing), PubSub.publish(standings, standing));
    const settings = yield* Settings;
    const settled = Effect.fnUntraced(function* ({ stayed, raised }: Effect.Success<ReturnType<typeof broughtUp>>) {
      const assured = yield* custody.ensure();
      const floor = floorDetail(raised, assured, address.state);
      const detail = stayed === null ? floor : `${floor} ${stayed}.`;
      yield* stand({
        boot: raised,
        custodian: assured._tag === 'Held',
        detail,
        notice:
          (stayed === null && assured._tag === 'Held' && (raised._tag === 'Adopted' || raised._tag === 'Raised')) ||
          (stayed !== null && assured._tag !== 'Held')
            ? null
            : detail,
        geometry: policy.execution.geometry,
        stays: assured._tag === 'Held' ? undefined : (stayed ?? undefined),
      });
      if (raised._tag !== 'Adopted' && raised._tag !== 'Raised') {
        yield* Effect.logWarning('this installation has no execution host', { detail: hostBootDetail(raised) });
      }
      if (assured._tag !== 'Held') {
        yield* Effect.logWarning('the terminals floor does not hold host custody', {
          reason: assured.reason._tag,
          detail: detailOf(assured.reason, address.state),
        });
      }
      const shares = yield* Effect.result(settings.changes(hostMemoryShare));
      if (shares._tag === 'Failure') {
        yield* Effect.logWarning('the execution host was left on the share it came up at', {
          reason: shares.failure._tag,
        });
      } else {
        yield* holdHostShare({ installation: address.installation, executions }, shares.success);
      }
    });
    if (brought !== undefined) yield* settled(brought);
    yield* drive(
      'request-key-retention',
      retainRequestKeys(units, requestKeys, 'startup').pipe(
        Effect.andThen(Effect.forever(Effect.sleep('24 hours').pipe(Effect.andThen(retainRequestKeys(units, requestKeys, 'scheduled'))))),
      ),
    );
    const targets = yield* makeTerminalTargets;
    const grants = makeTerminalGrants({ executions: host.port });
    const projectionOwners = hostServices(host.port).pipe(
      Context.add(RequestKeys, requestKeys),
      Context.add(TerminalIntents, intents),
      Context.add(TerminalRows, terminalRows),
      Context.add(CommandRows, commandRows),
      Context.add(TerminalGrants, grants),
    );
    const reconciliation = yield* makeTerminalReconciliation({ installation: address.installation }).pipe(Effect.provide(projectionOwners));
    const commands = yield* makeCommandAccess({
      commandRows,
      register: makeTerminalThreads({ db }),
      executions: custody.guarded(),
      rules: (projectId, thread, home) =>
        Effect.map(currentRules(machine, projectId, thread, home), (standing) => standing.map((one) => one.rule)),
    });
    const watched = yield* Queue.unbounded<TerminalWatched>();
    const ended = yield* Queue.unbounded<ExecutionRef>();
    const takingBack = yield* Deferred.make<NoticeTakeBack['Service']>();
    yield* Effect.addFinalizer(() => Deferred.interrupt(takingBack));
    const waiters = yield* makeCommandWaiters({ deliveries, ended, takeBack: Deferred.await(takingBack) });
    const cell = yield* makeTerminalInventory({ executions: custody.guarded() });
    const grids = yield* makeExecutionGrids({
      executions: custody.guarded(),
      viewOf: (binding: BindingId): ViewId | undefined => lanes.viewOf(binding),
      close: (binding, principal) => grants.closeOrKeep(binding, principal),
    });
    const writers = yield* makeTerminalWriters().pipe(Effect.provideService(TerminalRows, terminalRows));
    const owners = hostServices(custody.guarded()).pipe(
      Context.add(RequestKeys, requestKeys),
      Context.add(TerminalIntents, intents),
      Context.add(TerminalRows, terminalRows),
      Context.add(CommandRows, commandRows),
      Context.add(CommandDeliveries, deliveries),
      Context.add(TerminalTargets, targets),
      Context.add(TerminalGrants, grants),
      Context.add(TerminalReconciliation, reconciliation),
      Context.add(TerminalInventory, cell),
      Context.add(CommandWaiters, waiters),
      Context.add(InputWitness, grids),
      Context.add(TerminalWriters, writers),
    );
    const terminals = yield* makeHostTerminals({
      installation: address.installation,
      watched,
      displaced,
      programVersion,
      ready: custody.ready,
    }).pipe(Effect.provide(owners));
    const lanes = yield* makeTerminalLanes({ writing: terminals, grants, host: custody.guarded(), witness: grids, writers });
    yield* drive('terminal-grant-closes', grants.attendCloses(executionHandshakeMs));
    const endings = yield* makeTerminalEndings({ opened: watched, ended }).pipe(
      Effect.provide(
        Context.make(Terminals, terminals).pipe(
          Context.add(Discharge, terminals),
          Context.add(TerminalRows, terminalRows),
          Context.add(CommandRows, commandRows),
        ),
      ),
    );
    yield* Effect.forkScoped(endings.attend());
    const commandReader = yield* makeStoredCommands({ commandRows, requestKeys, host: custody.guarded() });
    const hostPace: HostPace['Service'] = {
      apply: (asked) =>
        host.port.pace(asked).pipe(
          Effect.mapError((failure) => ({
            reason:
              failure._tag === 'HostRefused'
                ? `the execution host refused it: ${failure.refusal.reason}`
                : failure._tag === 'WireUnavailable' || failure._tag === 'WireLost'
                  ? `the execution host could not be reached: ${failure.reason}`
                  : `the execution host could not answer: ${failure._tag}`,
          })),
        ),
    };
    const succession: SuccessionSteps['Service'] = {
      prepare: (restart, mode) =>
        prepareChange(executions, custody.ensure({ seen: true }), files, address.state, address.installation, claim, restart, mode).pipe(
          Effect.onExit((exit) => Ref.set(yielding, Exit.isSuccess(exit) && exit.value ? 'armed' : 'idle')),
        ),
      withdraw: Effect.flatMap(
        Ref.modify(yielding, (stage): [boolean, YieldStage] => (stage === 'yielding' ? [false, stage] : [true, 'idle'])),
        (open) => (open ? withdrawCandidate(files, address.state) : Effect.void),
      ),
      weigh: (bundle) =>
        weighBundle({
          executions,
          custody: custody.ensure({ seen: true }),
          files,
          registrations,
          state: address.state,
          installation: address.installation,
          claim,
          lifetime,
          bundle,
        }),
    };
    const booted = Effect.gen(function* () {
      const recovered = yield* Effect.result(waiters.recover());
      if (recovered._tag === 'Failure') {
        yield* Effect.logWarning(
          'endings a previous run was sending or reading could not be released; they stay unsent until a boot releases them',
          {
            reason: recovered.failure._tag,
          },
        );
      }
      yield* Effect.forkScoped(cell.follow());
      const resumed = yield* Effect.result(endings.resume());
      if (resumed._tag === 'Failure') {
        yield* Effect.logWarning('the executions held at boot could not be read, so none is watched', {
          reason: resumed.failure._tag,
        });
      }
      yield* Effect.forkScoped(terminals.disownGone());
      yield* Effect.forkScoped(Effect.andThen(intents.seedOpenTerminals(units), Effect.asVoid(terminals.sweepReplaced())));
      const dispose = Effect.asVoid(Effect.suspend(() => terminals.disposition()));
      yield* dispose;
      yield* drive(
        'terminal-disposition',
        Effect.forever(Effect.sleep(Duration.millis(executionHandshakeMs)).pipe(Effect.andThen(dispose))),
      );
    });
    if (takenAfter === undefined) yield* booted;
    else {
      const scope = yield* Effect.scope;
      yield* Effect.forkIn(
        Effect.gen(function* () {
          yield* takenAfter;
          const taken = yield* coldRoad;
          yield* settled(yield* broughtUp(taken, yield* offered(placementOf(taken))));
          yield* Deferred.succeed(admitted, undefined);
          yield* booted;
        }).pipe(
          Effect.tapCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) return Effect.void;
            const failed: HostBoot = { _tag: 'Unraised', reason: `taking the host over after the door failed: ${Cause.pretty(cause)}` };
            return Effect.andThen(
              stand({
                boot: failed,
                custodian: false,
                detail: hostBootDetail(failed),
                notice: hostBootDetail(failed),
                geometry: policy.execution.geometry,
              }),
              Effect.logError('the host was not taken over after the door', { cause: Cause.pretty(cause) }),
            );
          }),
          Effect.ensuring(Effect.andThen(Deferred.succeed(admitted, undefined), Deferred.succeed(takenOver, undefined))),
          Scope.provide(scope),
        ),
        scope,
      );
    }
    const hostState = HostManagement.of({ standing: Ref.get(live), connection: host });
    const feeds = yield* makeCommandFeed({
      terminals,
      evidence: terminals,
      commands: terminals.commands,
      custody: terminals,
      reader: commandReader,
    });
    const discharge = Discharge.of(terminals);
    return Context.make(Terminals, terminals)
      .pipe(
        Context.add(TerminalRequests, terminals),
        Context.add(TerminalWriting, terminals),
        Context.add(Custody, terminals),
        Context.add(ManagedCommands, terminals.commands),
        Context.add(ExecutionRecords, terminals),
        Context.add(TerminalScreens, terminals),
        Context.add(ExecutionProcessEvidence, terminals),
        Context.add(Discharge, discharge),
        Context.add(TerminalEndings, endings),
        Context.add(ExecutionHost, terminals),
        Context.add(HostManagement, hostState),
        Context.add(
          MachineHost,
          yield* makeMachineHost({
            host: hostState,
            standings: Stream.fromPubSub(standings),
            terminals,
            evidence: terminals,
            rows: Effect.matchEffect(
              units.read((unit) => Effect.all({ terminals: terminalRows.standing(unit), commands: commandRows.commandsStanding(unit) })),
              {
                onSuccess: Effect.succeed,
                onFailure: (failure) =>
                  Effect.as(
                    Effect.logDebug(
                      'the terminals and commands this installation holds could not be read; what a new host ends is unmeasured',
                      {
                        reason: failure._tag,
                      },
                    ),
                    null,
                  ),
              },
            ),
          }),
        ),
        Context.add(ViewLeases, yield* makeViewLeaseBook()),
        Context.add(ViewLanes, lanes),
        Context.add(TerminalGrids, grids),
      )
      .pipe(
        Context.add(TerminalAccess, makeTerminalAccess({ grants, threads: makeTerminalThreads({ db }) })),
        Context.add(CommandAccess, commands),
        Context.add(
          CommandReader,
          CommandReader.of({
            ...commandReader,
            ...makeCommandOutput({ commands: terminals.commands, reader: commandReader, waiters, terminals }),
            ...(yield* makeOutputSearch({ commands: terminals.commands, reader: commandReader })),
            follow: feeds.follow,
          }),
        ),
        Context.add(CommandWaiters, waiters),
        Context.add(TakeBackOpening, { open: (takeBack) => Effect.asVoid(Deferred.succeed(takingBack, takeBack)) }),
        Context.add(TerminalGrants, grants),
        Context.add(TerminalTargets, targets),
        Context.add(
          ServingGit,
          makeServingGit({ terminals, commands: terminals.commands, host: terminals, access: commands, targets, policy }),
        ),
        Context.add(HostPace, hostPace),
        Context.add(SuccessionSteps, succession),
        Context.add(ExecutionHistory, yield* makeExecutionHistory),
        Context.add(ServedRoots, yield* makeServedRoots.pipe(Effect.provide(owners))),
      );
  }),
);
