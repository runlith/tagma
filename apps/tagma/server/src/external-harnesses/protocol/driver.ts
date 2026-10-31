import { Clock, Duration, Effect, FiberMap, FiberSet, FileSystem, Schedule, Scope, Stream } from 'effect';
import { ActivityLog } from '@runlith/activity/log';
import type { RequestLanded } from '@runlith/agent/thread/run/requests';
import type { RunOwnership } from '@runlith/agent/thread/run/ThreadRunLedger';
import type {
  GuidanceSources,
  JournalRuns,
  LaunchGuidance,
  TransportCompaction,
  TransportResource,
  TransportRuns,
} from '@runlith/agent/thread/transport/contract';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { HarnessAccounts } from '../../providers/contract/service/harness.js';
import type { ProviderRegistry } from '../../providers/contract/service/registry.js';
import type { AccountQuota } from '../../providers/contract/service/quota.js';
import type { Attachments } from '../../threads/contract/service/attachments.js';
import type { CompactionPlanning } from '../../threads/contract/service/compaction.js';
import { failedAs, threadCallFailed, type HarnessFailure } from '../../threads/contract/service/failure.js';
import { LEASE_RHYTHM } from '../../threads/contract/wire/rhythm.js';
import type { NativeStorage } from '../../threads/contract/service/engine.js';
import type { ThreadAsides } from '@runlith/agent/thread/ThreadAsides';
import { HarnessAsides } from '../../threads/contract/service/asides.js';
import type { ThreadInbox } from '../../threads/store/inbox.js';
import type { TerminalEndings } from '../../executions/contract/service/endings.js';
import type { HostManagement } from '../../executions/contract/service/host.js';
import type { ExecutionRecords } from '../../executions/contract/service/records.js';
import type { TerminalRequests, Terminals } from '../../executions/contract/service/terminals.js';
import type { TerminalWriting } from '../../executions/contract/service/writing.js';
import type { HarnessJudging } from '../contract/service/permissions.js';
import type { ProtocolSessions } from '../contract/service/protocol.js';
import type { HarnessLanes } from '../sessions/lanes.js';
import type { ProjectDeclaring } from '../sessions/launch.js';
import type { ProtocolRows } from '../store/protocol.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { VendorTurns } from '../store/turns.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { RunActivities } from './activities.js';
import { ProtocolAlignment } from './alignment.js';
import { ProtocolAsides } from './asides.js';
import { makeSessionCopies } from './copies.js';
import { ProtocolAttendance } from './attendance.js';
import { protocolState } from './diagnosis.js';
import { ProtocolEndings, type SessionEnded } from './endings.js';
import { ProtocolHalts } from './halts.js';
import { ProtocolHistory } from './history.js';
import { ProtocolInputs } from './inputs.js';
import { HostedIntroductions } from './introductions.js';
import type { ProtocolJournal } from './journal.js';
import { ProtocolLauncher } from './launcher.js';
import { LinkEnded, linkedOf, ProtocolLinks, WaitExpired, type Linked } from './links.js';
import { IDLE_MS } from './idle.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { Answers } from './methods/answers.js';
import type { AsideOutcome, WithdrawOutcome } from './methods/declaration.js';
import { ProtocolOpening } from './opening.js';
import { ProtocolProcess } from './process.js';
import { ProtocolLaunches } from './launches.js';
import { ProtocolPrompts, type LaunchWords, type SessionPlace, type SteerWords } from './prompts.js';
import { ProtocolPreparing } from './preparing.js';
import { ProtocolRuns } from './runs.js';
import { ProtocolCancels } from './cancels.js';
import { ProtocolDelivery } from './delivery.js';
import { ProtocolLaunching } from './launching.js';
import { AskLandings } from './landings.js';
import { ProtocolAsks } from './questions.js';
import { ProtocolReactor, type TitleReported, type TurnBegun } from './reactor.js';
import type { AdapterDisplay } from '@runlith/agent/thread/run/lifecycle/RunReports';
import { ProtocolSteps } from './steps.js';

export class ProtocolDriver implements ProtocolSessions {
  constructor(
    private readonly attendance: ProtocolAttendance,
    private readonly inputs: ProtocolInputs,
    private readonly steps: ProtocolSteps,
    readonly runs: TransportRuns,
    readonly history: ProtocolHistory,
    readonly compaction: TransportCompaction,
    private readonly rows: ProtocolRows,
    private readonly turns: VendorTurns,
    private readonly links: ProtocolLinks,
    readonly state: (threadId: string) => ReturnType<typeof protocolState>,
  ) {
    this.writes = writes('ProtocolDriver.write', [], rows.writes, turns.writes);
  }

  readonly writes: WriteSet;

  static readonly make = Effect.fnUntraced(function* (
    store: HarnessSessionStore,
    rows: ProtocolRows,
    turns: VendorTurns,
    journal: ProtocolJournal,
    ownership: RunOwnership,
    threads: NativeStorage['Service']['threads'],
    nativeRuns: NativeStorage['Service']['runs'],
    held: ThreadAsides,
    inbox: ThreadInbox['Service'],
    records: ExecutionRecords['Service'],
    terminals: Terminals['Service'],
    requests: TerminalRequests['Service'],
    writing: TerminalWriting['Service'],
    executionEndings: TerminalEndings['Service'],
    host: HostManagement['Service'],
    settings: Settings['Service'],
    grants: GrantSigner['Service'],
    accounts: HarnessAccounts['Service'],
    providers: ProviderRegistry['Service'],
    quota: AccountQuota['Service'],
    lanes: HarnessLanes,
    permissions: HarnessJudging,
    planning: CompactionPlanning['Service'],
    pictures: Attachments['Service'],
    place: SessionPlace,
    ended: SessionEnded,
    guidance: LaunchGuidance,
    sources: GuidanceSources,
    standing: JournalRuns,
    titled: TitleReported,
    begun: TurnBegun,
    compacts: (threadId: string) => Effect.Effect<unknown, unknown>,
    display: AdapterDisplay,
    landed: Stream.Stream<RequestLanded>,
    ownerId: string,
    build: string,
    cli: readonly string[],
    declaring: ProjectDeclaring,
    routed: (threadId: string) => Effect.Effect<void, HarnessFailure>,
    options: { readonly graceMs?: number; readonly idleMs?: number } = {},
  ) {
    const graceMs = options.graceMs;
    const idleMs = options.idleMs ?? IDLE_MS;
    const adapters = yield* HarnessAdapters;
    const linked = (facet: ExternalSession): Effect.Effect<Linked, HarnessFailure> =>
      Effect.map(linkedOf(adapters, facet), (found) =>
        graceMs === undefined ? found : { ...found, profile: { ...found.profile, graceMs } },
      );
    const fibers = yield* FiberMap.make<string, void, never>();
    const asking = yield* FiberSet.make<void, never>();
    const compacting = (threadId: string): Effect.Effect<void> =>
      Effect.asVoid(
        FiberSet.run(
          asking,
          Effect.flatMap(Effect.result(compacts(threadId)), (done) =>
            done._tag === 'Failure'
              ? Effect.logWarning('an automatic compaction was not opened', { threadId, failure: done.failure })
              : Effect.void,
          ),
        ),
      );
    const tails = yield* FiberMap.make<string, void, never>();
    const files = yield* FileSystem.FileSystem;
    const log = yield* ActivityLog;
    const activities = new RunActivities(inbox, log, yield* Scope.Scope);
    yield* Effect.forkScoped(Stream.runForEach(landed, (request) => activities.requested(request)));
    const launches = new ProtocolLaunches(ownership);
    const links = new ProtocolLinks(store, rows);
    const landings = new AskLandings();
    const answers = new Answers<AsideOutcome>();
    const withdrawals = new Answers<WithdrawOutcome>();
    const introductions = new HostedIntroductions(links, journal);
    const steps = new ProtocolSteps(
      links,
      answers,
      withdrawals,
      store,
      rows,
      turns,
      journal,
      inbox,
      writing,
      lanes,
      activities,
      landings,
      display,
      tails,
      introductions,
    );
    const halts = new ProtocolHalts(links, store, terminals, requests);
    const asks = new ProtocolAsks(steps, permissions, journal, landings, routed);
    const alignment = new ProtocolAlignment(steps, halts, turns, launches, standing, guidance, providers, files, place);
    const preparing = yield* FiberMap.make<string, void, never>();
    const prompts = new ProtocolPrompts(
      steps,
      launches,
      inbox,
      journal,
      planning,
      pictures,
      place,
      compacting,
      guidance,
      sources,
      alignment,
      new ProtocolPreparing<LaunchWords>(links, preparing, 'launch'),
      new ProtocolPreparing<SteerWords>(links, preparing, 'steer'),
    );
    const opening = new ProtocolOpening(steps, halts, prompts, rows, alignment);
    const copies = yield* makeSessionCopies.pipe(Effect.provideService(HarnessAsides, held));
    const asides = new ProtocolAsides(links, steps, answers, inbox, threads, copies);
    const reactor = new ProtocolReactor(links, steps, halts, asks, prompts, opening, asides, quota, titled, begun, journal.stepped);
    const endings = new ProtocolEndings(
      steps,
      reactor,
      activities,
      store,
      rows,
      inbox,
      halts,
      ended,
      launches,
      nativeRuns,
      linked,
      ownerId,
    );
    const launcher = new ProtocolLauncher(
      endings,
      store,
      rows,
      terminals,
      requests,
      host,
      settings,
      grants,
      accounts,
      providers,
      place,
      ownerId,
      cli,
      files,
      declaring,
      adapters,
    );
    const process = new ProtocolProcess(
      links,
      steps,
      journal,
      reactor,
      asides,
      halts,
      launcher,
      endings,
      store,
      rows,
      records,
      terminals,
      executionEndings,
      lanes,
      inbox,
      nativeRuns,
      launches,
      linked,
      adapters,
      idleMs,
      ownerId,
      build,
    );
    const attendance = new ProtocolAttendance(
      links,
      process,
      endings,
      store,
      rows,
      inbox,
      ownership,
      launches,
      lanes,
      fibers,
      yield* FiberMap.make<string, void, never>(),
      yield* FiberMap.make<string, void, never>(),
      yield* Clock.Clock,
      log,
      idleMs,
      ownerId,
    );
    yield* Effect.forkScoped(attendance.hold());
    yield* Effect.forkScoped(
      Stream.runForEach(adapters.changes, () =>
        attendance.moved().pipe(
          Effect.tapError((failure) => Effect.logWarning('the sessions of a removed harness could not be read; trying again', { failure })),
          Effect.retry(Schedule.spaced(Duration.millis(LEASE_RHYTHM.takeoverAfterMs))),
        ),
      ),
    );
    const inputs = new ProtocolInputs(links, attendance, reactor, asks);
    const delivery = new ProtocolDelivery(links, reactor, prompts, launches, withdrawals, inbox);
    const launching = new ProtocolLaunching(
      launches,
      links,
      attendance,
      delivery,
      store,
      rows,
      inbox,
      ownership,
      threads,
      nativeRuns,
      guidance,
      journal,
      activities,
      alignment,
      ownerId,
    );
    const cancels = new ProtocolCancels(links, launches, attendance, steps, store, rows, nativeRuns, ownerId);
    const runs = new ProtocolRuns(launching, delivery, cancels, steps, introductions);
    const history = new ProtocolHistory(reactor, attendance, store, rows, turns, guidance, standing, adapters);
    const state = (threadId: string) => protocolState({ store, rows, records, terminals, attendance, ownerId }, threadId);
    return new ProtocolDriver(attendance, inputs, steps, runs.transport, history, runs.compaction, rows, turns, links, state);
  });

  readonly resource: TransportResource = {
    release: (threadId, operation) => failedAs('acp.release', this.attendance.stop(threadId, undefined, operation)),
    seated: () => Effect.void,
    watch: () => failedAs('acp.watch', this.attendance.watch()),
  };

  readonly seat: ProtocolSessions['seat'] = (source, unit) => this.history.seat(source, unit);

  readonly release: ProtocolSessions['release'] = (threadId, unit) =>
    Effect.andThen(this.rows.drop(unit, threadId), this.turns.forget(unit, threadId));

  ensure(threadId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.andThen(
      this.attendance.ensure(threadId),
      this.links
        .until(threadId, (link) => (link?.row.phase === 'ready' ? link : null))
        .pipe(
          Effect.mapError((failure) =>
            failure instanceof LinkEnded
              ? failure.refusal
              : failure instanceof WaitExpired
                ? new GateRefusal('session-uncertain', 'The agent session has not opened.', ['read the thread state'])
                : failure,
          ),
        ),
    );
  }

  current(threadId: string): Effect.Effect<string | null, HarnessFailure> {
    return Effect.map(this.rows.load(threadId), (row) => row?.turns.at(-1)?.id ?? null);
  }

  readonly asks: ProtocolSessions['asks'] = {
    answer: (threadId, question, answers) => Effect.mapError(this.inputs.answer(threadId, question, answers), threadCallFailed),
  };
}
