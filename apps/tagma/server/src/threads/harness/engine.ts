import { Cause, Clock, Context, Effect, Layer } from 'effect';
import { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '@runlith/agent/thread/kernelPorts';
import { ModelRuns, threadHostLayer } from '@runlith/agent/thread/ThreadPorts';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { ThreadTypes } from '@runlith/agent/collaboration/types';
import { WORKTREE_INHERIT } from '@runlith/agent/collaboration/CollaborationConfig';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { SourceProject } from '../../graph/contract/service/source.js';
import { resolveProject } from '../../graph/serving/selector.js';
import { ThreadToolRegistry } from '@runlith/agent/thread/ThreadPorts';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { failedAs } from '../contract/service/failure.js';
import { journalLaneFaces, ordering, ThreadJournalLane, type ThreadJournalLaneFaces } from '@runlith/agent/thread/transition/lane';
import type { WorkflowConfig } from '@runlith/agent/workflow/WorkflowConfig';
import { ActivityLog } from '@runlith/activity/log';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { SetupSettlements } from '../../worktrees/contract/service/setup.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { stored } from '../../platform/store/crossing.js';
import { Settings } from '../../settings/contract/service/values.js';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { ProviderRegistry } from '../../providers/contract/service/registry.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import type { ThreadRecord } from '@runlith/agent/thread/record';
import {
  ExternalThreads,
  HarnessOwner,
  HarnessToolOutputs,
  NativeAgents,
  NativeCompaction,
  NativeInputRecovery,
  NativeHistories,
  NativeStorage,
  NativeSwitches,
  NativeWorkflow,
  SettledRelease,
  ThreadHarness,
  ThreadJournal,
  ThreadLaunchGate,
  ThreadLive,
} from '../contract/service/engine.js';
import { ThreadLookup, ThreadPlaces, ThreadRunning } from '../contract/service/reads.js';
import { HarnessMoves } from '../contract/service/harness.js';
import { ThreadList } from '../contract/service/list.js';
import { fillSaid } from '../list/saidFill.js';
import { approverStanding, followRoutes, threadApprovers, type ApprovalDelivery } from '../approvers.js';
import { harnessModels, makeHarnessMoves } from './moves.js';
import { makeThreadRebinding } from './rebinding.js';
import { ThreadRebinding } from '../contract/service/rebinding.js';
import { makeEngineBirths } from './births.js';
import { makeEngineStates, makeSubAgentDepths, type SubAgentDepths } from './state.js';
import { CacheWarmth } from '../contract/service/evidence.js';
import { ContextLimits } from '../contract/service/limits.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import type { NativeThreadState } from '../contract/service/state.js';
import { LEASE_RHYTHM, REAPER_RHYTHM, RECONCILE_INTERVAL_MS, SETTLEMENT_RHYTHM } from '../contract/wire/rhythm.js';
import { ThreadTeams } from '../contract/service/team.js';
import { makeThreadTeams } from '../team.js';
import { republishOnDepthMove, republishOnMachineFlip, resolveDelegation } from '../birth/delegation.js';
import { SettingChanges } from '../../settings/contract/service/changes.js';
import { AwakePolicy } from '../../power/contract/service/awake.js';
import { MadeBirths, PlacementRefused, Placing, type PlacementCoordinator } from '../birth/placement.js';
import { JournalOrder } from '../journal/lane.js';
import { ThreadRollouts } from '../contract/service/rollouts.js';
import { RestedRollouts } from '../contract/service/rested.js';
import { projectionSweep } from '../journal/projectionSweep.js';
import { Maintenance, scheduleSweeps } from '../../platform/contract/service/maintenance.js';
import { drive } from '../../platform/contract/service/drives.js';
import { ExecutionHistory } from '../../executions/contract/service/history.js';
import { historySweep } from '../teardown.js';
import { makeSqliteThreadJournal } from '../journal/log.js';
import { makeConversationBackfill } from '../journal/conversationBackfill.js';
import { NoteWriting, makeWorktreeNotes } from '../journal/worktreeNotes.js';
import { cacheWarmthOf } from '../list/wire.js';
import { AttachmentFiles } from '../resources/attachments.js';
import { ThreadInbox } from '../store/inbox.js';
import { ThreadResources } from '../store/resources.js';
import { makeOwedCallRows } from '../store/owedCalls.js';
import { CallEpoch } from '../contract/service/owedCalls.js';
import { OwnWork } from '../contract/service/ownWork.js';
import { TagmaAppPoints } from '../../tagma-apps/contract/service/points.js';
import { ENDINGS, makeEndingDelivery } from './tagmaAppEndings.js';
import { makeRunSweep } from '../ending.js';
import { coldWakeRefusal, coldWakeTokens } from '../contract/wire/settings.js';
import { makeChildUpdates } from '../collaboration/childUpdates.js';
import { makeHeldTasks } from '../collaboration/heldTasks.js';
import { HolderCopies } from '../../graph/contract/service/holders.js';
import { HeldTasks } from '../contract/service/heldTasks.js';
import { WorkPlaces } from '../contract/service/working.js';
import { makeChildReads } from '../collaboration/childReads.js';
import { makeEventReads } from '../events/reads.js';
import { makeThreadEvents, type ThreadWarmth } from '../events/happened.js';
import { ThreadEvents } from '../contract/service/events.js';
import { ThreadSubscriptions } from '../contract/service/subscriptions.js';
import { makeOpener } from '../events/opener.js';
import { makeEventLines } from '../subscriptions/delivery.js';
import { makeSubscriptionRecipient } from '../subscriptions/recipient.js';
import { ModelChanges } from '../contract/service/modelChanges.js';

const STREAM_FLUSH_MS = 1_500;

function engineFeatures(
  resources: ThreadResources['Service'],
  warmth: CacheWarmth['Service'],
  limits: ContextLimits['Service'],
  mandate: ThreadMandate['Service'],
  settings: Settings['Service'],
  depths: SubAgentDepths,
  placement: PlacementCoordinator,
  workflow: WorkflowConfig,
  selecting: Context.Context<Projects | SourceProject>,
  models: (runId?: string) => ModelCatalog,
  menu: (runId?: string) => ModelCatalog,
  teams: ThreadTeams['Service'],
  subscriptions: ThreadSubscriptions['Service'],
) {
  const homeOf = (thread: ThreadRecord) =>
    thread.projectId === undefined
      ? Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread ${thread.id} works no project, so nothing places its child.`) }))
      : Effect.succeed(thread.projectId);
  return threadFeaturesLayer({
    resources,
    collaboration: {
      models,
      menu,
      team: (thread, runId) =>
        teams
          .of({ threadId: thread.id, projectId: thread.projectId, runId })
          .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
      reconcileIntervalMs: RECONCILE_INTERVAL_MS,
      warmth: (resting) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          warmth.warmthBasis(resting).pipe(
            Effect.map((basis) => resting.map((thread) => cacheWarmthOf(thread, false, basis, now))),
            Effect.mapError((cause) => new ThreadCallBroke({ cause })),
          ),
        ),
      coldWake: (thread) =>
        Effect.all({
          refuse: settings.value(coldWakeRefusal, thread.projectId),
          tokens: settings.value(coldWakeTokens, thread.projectId),
        }).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
      limits: (threads) => limits.of(threads).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
      subscribe: (subscriberId, targetId, wakes) =>
        subscriptions.subscribe(subscriberId, [targetId], wakes).pipe(
          Effect.asVoid,
          Effect.mapError((cause) => new ThreadStorageFailed({ call: 'ThreadSubscriptions.subscribe', cause })),
        ),
      subAgentDepth: (thread) => depths.of(thread.spawnRootId),
      delegation: (thread) =>
        resolveDelegation(mandate, settings, thread.id).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
      placement: {
        asking: (thread) =>
          thread.projectId === undefined
            ? Effect.succeed(null)
            : placement.asking(thread.projectId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))),
        home: Effect.fnUntraced(function* (parent, project) {
          const parentProjectId = yield* homeOf(parent);
          const row = yield* resolveProject(project).pipe(
            Effect.provide(selecting),
            Effect.mapError((failure) =>
              failure instanceof GateRefusal
                ? new ThreadCallBroke({ cause: new PlacementRefused(failure) })
                : new ThreadCallBroke({ cause: failure }),
            ),
          );
          const worktrees = yield* placement.asking(row.id).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
          return { projectId: row.id, parentProjectId, worktrees };
        }),
        resolve: Effect.fnUntraced(function* (ask) {
          const projectId = ask.project ?? (yield* homeOf(ask.parent));
          if (ask.project !== undefined && ask.worktree === WORKTREE_INHERIT) return { projectId };
          const placed = yield* placement
            .resolve({
              projectId,
              worktree: ask.worktree,
              from: ask.project === undefined ? ask.parent.id : null,
              operationId: ask.project === undefined ? `spawn:${ask.requestId}` : `spawn:${ask.requestId}@${ask.project}`,
              name: ask.name ?? ask.agentId,
              agent: true,
              asked: ask.asked,
              guest: ask.host !== undefined || ask.parent.host !== null,
            })
            .pipe(Effect.mapError((refusal) => new ThreadCallBroke({ cause: new PlacementRefused(refusal) })));
          return ask.project === undefined ? placed : { ...placed, projectId };
        }),
        released: (place) => placement.abandoned(place),
      },
    },
    workflow,
  });
}

export const threadEngineLayer = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    const records = yield* ThreadRecords;
    const settings = yield* Settings;
    const mandate = yield* ThreadMandate;
    const rollouts = yield* ThreadRollouts;
    const rested = yield* RestedRollouts;
    const placement = yield* Placing;
    const resources = yield* ThreadResources;
    const lookup = yield* ThreadLookup;
    const list = yield* ThreadList;
    const inbox = yield* ThreadInbox;
    const places = yield* ThreadPlaces;
    const live = yield* ThreadLive;
    const owner = yield* HarnessOwner;
    const native = yield* NativeStorage;
    const compaction = yield* NativeCompaction;
    const modes = yield* ApprovalModes;
    const providers = yield* ProviderRegistry;
    const catalogOf = (runId?: string) => (runId === undefined ? providers.current() : providers.forRun(runId));
    const models = (runId?: string) => catalogOf(runId).models;
    const menu = (runId?: string) => catalogOf(runId).menu;
    const teams = yield* makeThreadTeams;
    const journal = yield* makeSqliteThreadJournal;
    const backfill = yield* makeConversationBackfill({ journal });
    const lifetime = yield* Effect.scope;
    const ordered = yield* JournalOrder;
    const lane = journalLaneFaces(ordered);
    const entered: ThreadJournalLaneFaces['enter'] = (threadId, place, work) =>
      lane.enter(
        threadId,
        place,
        rollouts.owed(threadId).pipe(
          Effect.mapError((cause) => new ThreadStorageFailed({ call: 'rollout.owed', cause })),
          Effect.andThen(journal.open(threadId)),
          Effect.andThen(work),
        ),
      );
    const binder = yield* makeThreadRebinding.pipe(Effect.provideService(ThreadJournal, journal));
    const moves = yield* makeHarnessMoves({
      releasing: (threadId) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL).release(),
      handed: Effect.fnUntraced(function* (threadId) {
        yield* harness.threads.publish(threadId);
        const row = yield* lookup.summary(threadId);
        if (row !== undefined) list.announce(row);
        yield* rollouts.appendMeta(threadId);
      }),
      models,
    }).pipe(Effect.provideService(ThreadRebinding, binder));
    const notes = yield* makeWorktreeNotes({
      placedIn: (projectId, rootId) =>
        Effect.map(places.placedIn(projectId, rootId), (placed) => placed.filter((thread) => thread.archivedAt === null)),
      append: (threadId, events) => Effect.suspend(() => harness.threads.handle(threadId, OPERATOR_PRINCIPAL).append(events)),
    });
    const births = yield* makeEngineBirths({ transports: () => harness.runs.transports(), models: () => models() }).pipe(
      Effect.provideService(NoteWriting, notes),
    );
    const depths = yield* makeSubAgentDepths;
    const owedRows = yield* makeOwedCallRows;
    const ownWork = yield* OwnWork;
    const epoch = (yield* CallEpoch).id;
    const standingOf = approverStanding(lookup, mandate, settings);
    const states = yield* makeEngineStates({ depths, standingOf });
    let delivering: ApprovalDelivery | null = null;
    const approvers = threadApprovers(standingOf, lookup, mandate, settings, () => delivering);
    const ports = Layer.mergeAll(
      threadStorageLayer<Unit<'machine'>, WriteUnit<'machine'>>({
        storage: native.threads,
        eventLog: journal,
        transitions: native.transitions,
        createRuns: native.runs,
        attachments: yield* AttachmentFiles,
        inbox,
        toolOutputs: yield* HarnessToolOutputs,
        ownerSettings: native.ownerSettings,
        cacheObservations: native.cacheObservations,
      }),
      engineFeatures(
        resources,
        yield* CacheWarmth,
        yield* ContextLimits,
        mandate,
        settings,
        depths,
        placement,
        yield* NativeWorkflow,
        Context.make(Projects, yield* Projects).pipe(Context.add(SourceProject, yield* SourceProject)),
        models,
        menu,
        teams,
        yield* ThreadSubscriptions,
      ),
      Layer.succeed(ModelRuns, { admit: providers.pinRun, release: providers.releaseRun }),
      Layer.succeed(ThreadEntryKinds, yield* ThreadEntryKinds),
      threadCompactorLayer(compaction.compaction),
      threadHostLayer<WriteUnit<'machine'>, Unit<'machine'>>({
        rhythms: { lease: LEASE_RHYTHM, reaper: REAPER_RHYTHM, settlement: SETTLEMENT_RHYTHM, streamFlushIntervalMs: STREAM_FLUSH_MS },
        ownerId: owner.id,
        approvers,
        inputRecovery: yield* NativeInputRecovery,
        births,
        owedCalls: {
          owe: (call, tx) =>
            call.threadId === null
              ? Effect.void
              : owedRows
                  .owe(tx, call, call.threadId, epoch)
                  .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'OwedCalls.owe', cause }))),
        },
        ownWork: {
          owed: (threadId) =>
            ownWork.owing([threadId]).pipe(
              Effect.map((owing) => owing.length > 0),
              Effect.mapError((cause) => new ThreadStorageFailed({ call: 'OwnWork.owing', cause })),
            ),
          endings: ownWork.endings,
        },
        readiness: {
          ready: (thread) =>
            Effect.andThen(
              births.ready(thread),
              Effect.forkIn(
                backfill
                  .thread(thread.id)
                  .pipe(Effect.tapCause((cause) => Effect.logError(`the conversation index of ${thread.id} stopped catching up`, cause))),
                lifetime,
              ),
            ),
        },
        resting: {
          resting: (threadId, tx) =>
            Effect.map(
              Effect.mapError(records.facts(threadId, tx), (cause) => new ThreadStorageFailed({ call: 'resting', cause })),
              (facts) => facts?.archivedAt != null,
            ),
        },
        residence: {
          holding: (threadId, work) => rollouts.using(threadId, Effect.andThen(failedAs('resident', rollouts.rehydrate(threadId)), work)),
          reading: (threadId, work) => rollouts.using(threadId, rested.reading(threadId, work)),
        },
        modelMoves: { moved: (thread) => rollouts.appendMeta(thread.id) },
        standingSwitches: yield* NativeSwitches,
        sweep: yield* makeRunSweep(),
      }),
      threadAgentsLayer(yield* NativeAgents),
      Layer.succeed(ThreadToolRegistry, yield* ThreadToolRegistry),
      Layer.succeed(ApprovalModes, modes),
      Layer.succeed(ThreadTypes, yield* ThreadTypes),
      Layer.succeed(RunAdmission, yield* RunAdmission),
      Layer.succeed(ThreadJournalLane, {
        place: () => lane.place(),
        enter: entered,
        order: ordering(ordered.declaration.name, () => lane.place(), entered),
      }),
      Layer.succeed(ActivityLog, yield* ActivityLog),
    );
    const endings = yield* makeEndingDelivery;
    yield* Effect.acquireRelease((yield* TagmaAppPoints).declare(ENDINGS, endings.register), (withdraw) => Effect.sync(withdraw));
    const evidence = yield* CacheWarmth;
    const warmth: ThreadWarmth = (summary, now) =>
      Effect.map(evidence.warmthBasis([summary]), (basis) => cacheWarmthOf(summary, false, basis, now));
    const lines = makeEventLines({ inbox, outputs: yield* HarnessToolOutputs, harness: () => harness });
    const children = yield* makeChildUpdates({
      threads: lookup,
      storage: native,
      warmth,
      reads: yield* makeChildReads,
      lines,
    });
    const eventReads = yield* makeEventReads;
    const subscribers = makeSubscriptionRecipient({ subscriptions: yield* ThreadSubscriptions, threads: lookup, lines, reads: eventReads });
    const workPlaces = yield* WorkPlaces;
    const held = yield* makeHeldTasks({ threads: lookup, places: workPlaces, placement, lines });
    const holderCopies = yield* HolderCopies;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        holderCopies.serve((threadId, projectId) =>
          Effect.flatMap(lookup.summary(threadId), (thread) =>
            thread === undefined || thread.projectId !== projectId ? Effect.succeed(null) : held.worked(thread),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new GateRefusal('copies-unreadable', `The places thread ${threadId} works in could not be read: ${cause.message}`, [
                  'read the thread’s work again once its places answer',
                ]),
            ),
          ),
        ),
      ),
      (stop) => Effect.sync(stop),
    );
    const events = yield* makeThreadEvents({
      threads: lookup,
      list,
      states: (listener) => live.subscribeStates(listener),
      warmth,
      reads: eventReads,
      opener: makeOpener({ inbox, storage: native }),
      recipients: [endings.recipient, children.recipient, subscribers, held.recipient],
    });
    const harness: ThreadHarness['Service'] = yield* AgentHarness.make<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>(
      ports,
      live,
      {
        toState: states.of,
        settled: yield* SettledRelease,
        subscribers: events.subscribers,
        gate: yield* ThreadLaunchGate,
        fillers: {
          threads: yield* ExternalThreads,
          compaction: compaction.fill,
          model: (owned) => harnessModels(owned, moves),
        },
      },
    );
    const modelChanges = yield* ModelChanges;
    yield* Effect.acquireRelease(
      Effect.sync(() => modelChanges.follow((threadId, change) => events.told(threadId, { kind: 'model-changed', change }))),
      (unfollow) => Effect.sync(unfollow),
    );
    delivering = (threadId, envelope) => harness.inputs.deliver(threadId, OPERATOR_PRINCIPAL, envelope);
    yield* Effect.acquireRelease(
      Effect.sync(() => rollouts.rewritten((threadId) => harness.threads.rewritten(threadId))),
      (unfollow) => Effect.sync(unfollow),
    );
    const made = yield* MadeBirths;
    yield* Effect.acquireRelease(
      Effect.sync(() => made.on((threadId, rootId) => notes.created(threadId, rootId))),
      (release) => Effect.sync(release),
    );
    const settlements = yield* SetupSettlements;
    yield* Effect.acquireRelease(
      Effect.sync(() => settlements.on((rootId) => notes.setup(rootId))),
      (release) => Effect.sync(release),
    );
    yield* Effect.addFinalizer(() => harness.dispose());
    yield* scheduleSweeps('thread-sweeps', [projectionSweep(rollouts), historySweep(yield* ExecutionHistory)]);
    const opened = (yield* Maintenance).opened;
    yield* drive('rollout-shelving', Effect.asVoid(Effect.andThen(opened, rollouts.shelving)));
    yield* drive(
      'rollout-reconciling',
      Effect.andThen(opened, rollouts.replay()).pipe(
        Effect.asVoid,
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError('the rollouts marked with an unfinished write stay marked until the next start', cause),
        ),
      ),
    );
    yield* Effect.forkScoped(
      Effect.andThen(opened, events.start()).pipe(
        Effect.tapCause((cause) => Effect.logError('the cooling of resting threads goes unwatched until the next start', cause)),
      ),
    );
    yield* drive(
      'said-backfill',
      Effect.andThen(opened, fillSaid(store.db, units, list)).pipe(
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError('the said lines of threads in SQL stay unfilled until the next start', cause),
        ),
      ),
    );
    yield* Effect.forkScoped(
      backfill.run().pipe(Effect.tapCause((cause) => Effect.logError('the conversation index backfill stopped', cause))),
    );
    yield* followRoutes(harness);
    const awake = yield* AwakePolicy;
    harness.runs.onDriving((count) => awake.working(count));
    const histories = yield* NativeHistories;
    yield* Effect.acquireRelease(
      Effect.sync(() => histories.serveDriven(() => new Set(harness.runs.driven().map((run) => run.threadId)))),
      (stop) => Effect.sync(stop),
    );
    harness.runs.onDriving(() => histories.reconsider());
    yield* republishOnMachineFlip(
      settings,
      () => live.watched(),
      (threadId) => harness.threads.publish(threadId),
    );
    yield* republishOnDepthMove(
      yield* SettingChanges,
      () => live.watched(),
      (threadId) => harness.threads.publish(threadId),
    );
    return Context.make(ThreadHarness, harness).pipe(
      Context.add(ThreadJournal, journal),
      Context.add(NoteWriting, notes),
      Context.add(HarnessMoves, moves),
      Context.add(ThreadRebinding, binder),
      Context.add(ThreadTeams, teams),
      Context.add(ThreadEvents, { told: events.told, serveDecisions: events.serveDecisions }),
      Context.add(HeldTasks, held.service),
    );
  }),
);
