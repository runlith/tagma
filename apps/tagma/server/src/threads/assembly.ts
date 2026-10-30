import { Cause, Context, Effect, Exit, Layer, Queue } from 'effect';
import { isPortRefusal } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import { RequestKey } from '../platform/contract/wire/ids.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { ThreadId } from '../platform/contract/wire/thread.js';
import { WorktreeUnavailable } from '../worktrees/contract/wire/failures.js';
import {
  type FinishingThreads,
  type ThreadStop,
  type WorktreeThreadPort,
  WorktreeThreads,
} from '../worktrees/contract/service/finishingGate.js';
import { WorktreeIntents } from '../worktrees/contract/service/intents.js';
import { Assignments } from '../workspace/contract/service/assignments.js';
import { WorkPlaces } from './contract/service/working.js';
import { makeWorkingPlaces } from './working.js';
import type { RootId } from '../workspace/contract/wire/ids.js';
import { assignmentMembership, assignmentSelection } from '../workspace/store/tables.js';
import { Custody } from '../executions/contract/service/custody.js';
import { NoticeTakeBack } from '../executions/contract/service/notices.js';
import { Remeasure } from '../enforcement/contract/service/remeasure.js';
import { RULE_ESCAPED_SIGNAL } from '../enforcement/contract/wire/checks.js';
import { ExternalThreads, HarnessAsides, ThreadHarness } from './contract/service/engine.js';
import { MergeNotice } from '../landing/contract/service/mergeNotice.js';
import { makeMergeNotice } from './mergeNotice.js';
import { Conversations } from './contract/service/conversations.js';
import { makeConversationReads } from './journal/conversationReads.js';
import { ThreadLookup, ThreadPlaces, ThreadReading, ThreadRunning } from './contract/service/reads.js';
import { MadeBirths, makePlacementCoordinator, Placing, madeBirths } from './birth/placement.js';
import { ThreadPlacement } from './contract/service/placement.js';
import { ThreadRoots } from '../change-record/contract/service/threadRoots.js';
import { LoadOwnerFacts } from '../executions/contract/service/owners.js';
import { ownerFacts } from './list/ownerFacts.js';
import { SessionLookupStore, makeSessionLookups } from './store/sessionLookups.js';
import { ThreadDirectory, makeThreadDirectory } from './store/directory.js';
import { HarnessRegistry } from './contract/service/harness.js';
import { ThreadReleasing } from './contract/service/releasing.js';
import { ThreadRollouts } from './contract/service/rollouts.js';
import { ThreadList } from './contract/service/list.js';
import { ThreadInbox, makeThreadInbox } from './store/inbox.js';
import { ThreadBirths, makeThreadBirths } from './birth/acts.js';
import { AttachmentFiles } from './resources/attachments.js';
import { makeThreadNaming } from './naming/generate.js';
import { makeExcerptAsks } from './naming/excerpt.js';
import { makeThreadDecisions } from './decisions.js';
import { makeThreadAsks } from './asks.js';
import { ThreadAsks } from './contract/service/asks.js';
import { askSetting, modelsNamed } from '../providers/askSettings.js';
import { decisionModel, titleModel } from './contract/wire/settings.js';
import { ThreadTitles } from './contract/service/titles.js';
import { ThreadDecisions } from './contract/service/decisions.js';
import { ThreadMoves, makeThreadMover } from './targets/moves.js';
import { makeThreadTargets } from './targets/decide.js';
import { makeTargetContexts } from './targets/preparation.js';
import { TargetPreparation } from './contract/service/preparation.js';
import { makeThreadEnding, ThreadEnding } from './ending.js';
import { attachments } from './turns/attachments.js';
import { Attachments } from './contract/service/attachments.js';
import { ThreadAdjustments, makeThreadAdjustments } from './turns/adjustments.js';
import { ThreadDetachment, makeThreadDetachment } from './collaboration/detachment.js';
import { QuestionAnswers, makeQuestionAnswers } from './turns/answers.js';
import { ThreadTurns, makeThreadTurns } from './turns/acts.js';
import { ThreadRewinds, makeThreadRewinds } from './turns/rewinds.js';
import { ReaderMarking, makeReaderMarks } from './turns/reader.js';
import { makeCommandDelivery } from './collaboration/commandEndings.js';
import { makeCallEndings } from './collaboration/callEndings.js';
import { CALL_RESULT_SIGNAL } from './contract/wire/calls.js';
import { makeOwedCallRows } from './store/owedCalls.js';
import { OwedCalls } from './contract/service/owedCalls.js';
import type { CallAddress } from '@runlith/agent/callProgress';
import { CUSTODY_NOTICE_PASS_MS, makeCustodyNotices, TERMINAL_CUSTODY_SIGNAL } from './collaboration/custodyNotices.js';
import { commandNoticeTakeBack, commandSignalSend, stayIdle, wakeUnlessStopped } from './collaboration/signals.js';
import { AGENT_IDLE_MS } from '@runlith/agent/callProgress';
import { RECAP_MARGIN_MS, RECAP_WAIT_MS } from './contract/wire/rhythm.js';
import { ThreadRecaps } from './contract/service/recaps.js';
import { ThreadRecapWriting } from './contract/service/recapWriting.js';
import { makeThreadRecaps } from './recap/readings.js';
import { makeRecapSchedule } from './recap/schedule.js';
import { makeExternalBirthRows } from './birth/externalRows.js';
import { makeExternalThreads, withExternalThreads } from './harness/collaboration.js';
import { WorktreeOwners } from '../worktrees/contract/service/owners.js';
import { WorktreeUpdates } from './contract/service/worktreeUpdates.js';
import { worktreeUpdates } from './worktreeUpdates.js';
import { SessionBirthWriting } from './contract/service/sessionBirths.js';
import { PinOffers, ThreadPins } from './contract/service/pins.js';
import { makePinnableViews } from './pinOffers.js';
import { makeThreadPins } from './store/pins.js';
import { ThreadSubscriptions } from './contract/service/subscriptions.js';
import { ThreadEvents, type ThreadFact } from './contract/service/events.js';
import { CommitLandings } from '../landing/contract/service/commitLandings.js';
import { WorkEnds } from '../graph/contract/service/workEnds.js';
import { HolderStandings } from '../graph/contract/service/holders.js';
import { makeEventReads } from './events/reads.js';
import { makeThreadSubscriptions } from './store/subscriptions.js';
import { OperatorNotes } from './contract/service/notes.js';
import { makeOperatorNotes } from './notes/owner.js';
import { notesRule } from './notes/rule.js';
import { AgentRules } from './contract/service/rules.js';
import { TagmaAppPoints } from '../tagma-apps/contract/service/points.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import { ModelChanges } from './contract/service/modelChanges.js';
import { makeModelChanges } from './events/modelChanges.js';
import { ThreadHomes } from './contract/service/homes.js';
import { makeThreadHomes } from './homes.js';

export const threadStoresLayer = Layer.effectContext(
  Effect.gen(function* () {
    const db = (yield* MachineStore).db;
    const places = yield* makeWorkingPlaces;
    const notes = yield* makeOperatorNotes;
    const pinnable = makePinnableViews();
    yield* Effect.acquireRelease((yield* TagmaAppPoints).declare(pinnable.point), (withdraw) => Effect.sync(withdraw));
    return Context.make(ThreadInbox, yield* makeThreadInbox).pipe(
      Context.add(WorkPlaces, places),
      Context.add(PinOffers, pinnable),
      Context.add(MadeBirths, madeBirths()),
      Context.add(SessionLookupStore, yield* makeSessionLookups),
      Context.add(ThreadDirectory, yield* makeThreadDirectory),
      Context.add(ModelChanges, yield* makeModelChanges),
      Context.add(LoadOwnerFacts, ownerFacts(db)),
      Context.add(ThreadRecaps, yield* makeThreadRecaps),
      Context.add(ThreadPins, yield* makeThreadPins),
      Context.add(ThreadSubscriptions, yield* makeThreadSubscriptions),
      Context.add(OperatorNotes, notes),
      Context.add(AgentRules, { rules: [notesRule(notes)] }),
      Context.add(ThreadHomes, yield* makeThreadHomes),
    );
  }),
);

export const worktreeThreadsLayer = Layer.effect(
  WorktreeThreads,
  Effect.gen(function* () {
    const units = yield* MachineUnits;
    const threads = { ...(yield* ThreadLookup), ...(yield* ThreadPlaces) };
    const list = yield* ThreadList;
    const assignments = yield* Assignments;
    const unread = (failure: { readonly message: string }) => new WorktreeUnavailable({ reason: 'storage', message: failure.message });
    const failed = (failure: { readonly message: string }) => ({ message: failure.message });
    let stopper: ThreadStop | null = null;
    const port: WorktreeThreadPort = {
      live: (projectId: number) => Effect.mapError(threads.standings(projectId), unread),
      placedIn: (projectId: number, rootId: string) => Effect.mapError(threads.placedIn(projectId, rootId), unread),
      archive: (projectId: number, threadId: string, archived: boolean) =>
        list.setArchived(threadId, projectId, archived).pipe(Effect.asVoid, Effect.mapError(failed)),
      stop: (projectId: number, threadId: string) =>
        stopper === null
          ? Effect.fail({ message: 'no thread engine serves yet, so nothing running can be stopped' })
          : stopper(projectId, threadId),
      stopping: (stop: ThreadStop) => {
        stopper = stop;
        return () => {
          if (stopper === stop) stopper = null;
        };
      },
      place: (threadId: string, root: Parameters<FinishingThreads['place']>[1]) =>
        units
          .write(writes('threads.place', [assignmentMembership, assignmentSelection]), (unit) =>
            assignments.select(unit, { actor: { kind: 'operator' }, threadId: ThreadId.make(threadId), root }),
          )
          .pipe(
            Effect.tap(() =>
              threads.summary(threadId).pipe(
                Effect.map((row) => {
                  if (row !== undefined) list.announce(row);
                }),
                Effect.catchCause((cause) => Effect.logWarning('a re-placed thread could not be announced', { threadId, cause })),
              ),
            ),
            Effect.asVoid,
            Effect.mapError(failed),
          ),
      standingRoot: (threadId: string) =>
        units
          .read((unit) => assignments.read(unit, ThreadId.make(threadId)))
          .pipe(Effect.map((assignment) => (assignment.standing === 'live' ? assignment.selection.rootId : null))),
      placing: (projectId: number, threadIds?: readonly string[]) => threads.standings(projectId, threadIds),
      threadsMoved: (projectId: number, listener: (threadId: string | null) => void) =>
        list.subscribe(projectId, (event) =>
          listener(event.kind === 'row' ? event.row.id : event.kind === 'removed' ? event.threadId : null),
        ),
    };
    return port;
  }),
);

export const threadTargetsLayer = Layer.effect(
  TargetPreparation,
  Effect.gen(function* () {
    return yield* makeTargetContexts;
  }),
);

export const placingLayer = Layer.effect(Placing, makePlacementCoordinator);

export const harnessFillersLayer = Layer.effectContext(
  Effect.gen(function* () {
    const directory = yield* ThreadDirectory;
    const birthRows = yield* makeExternalBirthRows;
    const external = yield* makeExternalThreads;
    return Context.make(ExternalThreads, (native) => withExternalThreads(native, external, (query) => directory.list(query))).pipe(
      Context.add(SessionBirthWriting, birthRows),
    );
  }),
);

export const threadsLayer = Layer.effectContext(
  Effect.gen(function* () {
    const harness = yield* ThreadHarness;
    const pins = yield* ThreadPins;
    yield* Effect.acquireRelease(
      Effect.sync(() => pins.changed((threadId) => harness.threads.publish(threadId))),
      (dispose) => Effect.sync(dispose),
    );
    const releasing = yield* ThreadReleasing;
    yield* Effect.acquireRelease(
      Effect.sync(() => releasing.serve((threadId) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL).release())),
      (stopServing) => Effect.sync(stopServing),
    );
    const records = yield* ThreadRecords;
    const threads = { ...(yield* ThreadLookup), ...(yield* ThreadRunning), ...(yield* ThreadReading) };
    const list = yield* ThreadList;
    const rollouts = yield* ThreadRollouts;
    const registry = yield* HarnessRegistry;
    const placement = yield* Placing;
    const custody = yield* Custody;
    yield* askSetting(titleModel, 'text', modelsNamed);
    yield* askSetting(decisionModel, 'decision', modelsNamed);
    const threadAsks = yield* makeThreadAsks;
    const excerpts = yield* makeExcerptAsks({ idleMs: AGENT_IDLE_MS });
    const naming = yield* makeThreadNaming({ idleMs: AGENT_IDLE_MS, excerpts }).pipe(Effect.provideService(ThreadAsks, threadAsks));
    const decisions = yield* makeThreadDecisions;
    const events = yield* ThreadEvents;
    yield* Effect.acquireRelease(
      Effect.sync(() => events.serveDecisions(decisions)),
      (release) => Effect.sync(release),
    );
    const telling = (threadId: string, fact: ThreadFact) =>
      Effect.catchCause(events.told(threadId, fact), (cause) =>
        Effect.logWarning('a thread fact could not be told to its recipients', { threadId, fact: fact.kind, reason: Cause.pretty(cause) }),
      );
    const landings = yield* CommitLandings;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        landings.subscribe((landed) => telling(landed.threadId, { kind: 'committed', commit: landed.commit, subject: landed.subject })),
      ),
      (stop) => Effect.sync(stop),
    );
    const workEnds = yield* WorkEnds;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        workEnds.subscribe((ended) =>
          telling(ended.threadId, {
            kind: 'task-closed',
            id: crypto.randomUUID(),
            block: ended.block,
            title: ended.title,
            word: ended.word,
          }),
        ),
      ),
      (stop) => Effect.sync(stop),
    );
    const holders = yield* HolderStandings;
    const eventReads = yield* makeEventReads;
    yield* Effect.acquireRelease(
      Effect.sync(() => holders.serve(eventReads.holders)),
      (stop) => Effect.sync(stop),
    );
    const asides = yield* HarnessAsides;
    const recaps = yield* makeRecapSchedule({
      published: Effect.fnUntraced(function* (threadId: string) {
        yield* harness.threads.publish(threadId);
        const row = yield* threads.summary(threadId);
        if (row !== undefined) list.announce(row);
        yield* rollouts.appendMeta(threadId);
      }),
      progressed: (threadId) => harness.threads.publish(threadId),
      timing: { waitMs: RECAP_WAIT_MS, marginMs: RECAP_MARGIN_MS, idleMs: AGENT_IDLE_MS },
    }).pipe(Effect.provideService(ThreadAsks, threadAsks));
    yield* Effect.acquireRelease(
      Effect.sync(() => asides.watch(recaps)),
      (release) => Effect.sync(release),
    );

    const adjustments = yield* makeThreadAdjustments.pipe(Effect.provideService(ThreadTitles, naming));
    const detachment = yield* makeThreadDetachment;
    const ending = yield* makeThreadEnding({
      harness: { handle: (id, owner) => harness.threads.handle(id, owner) },
    });
    yield* Effect.acquireRelease(
      Effect.sync(() => list.serveArchiving((ids, work) => ending.archiving(ids, work))),
      (stopServing) => Effect.sync(stopServing),
    );
    const projectChanges = yield* ProjectChanges;
    yield* Effect.acquireRelease(
      Effect.sync(() => projectChanges.removed.subscribe(({ projectId }) => ending.closeProject(projectId))),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const reader = yield* makeReaderMarks;
    const births = yield* makeThreadBirths;
    const turns = yield* makeThreadTurns.pipe(Effect.provideService(ThreadEnding, ending), Effect.provideService(ReaderMarking, reader));
    const attachmentFiles = yield* AttachmentFiles;
    const rewinds = yield* makeThreadRewinds.pipe(Effect.provideService(ReaderMarking, reader));
    const answers = yield* makeQuestionAnswers.pipe(Effect.provideService(ReaderMarking, reader));
    const attachmentOwner = attachments(records, attachmentFiles);
    const intents = yield* WorktreeIntents;
    const targets = yield* makeThreadTargets({
      threads: {
        facetOf: (threadId) =>
          threads.find(threadId, OPERATOR_PRINCIPAL).pipe(
            Effect.map((row) => (row === undefined ? undefined : { projectId: row.projectId, hostKind: row.hostKind })),
            Effect.catch((failure) => (isPortRefusal(failure) ? Effect.succeed(undefined) : Effect.die(failure))),
          ),
      },
      creations: {
        of: (operationId) =>
          Effect.map(
            Effect.mapError(
              intents.byId(RequestKey.make(operationId)),
              (cause) => new ThreadStorageFailed({ call: 'ThreadTargetCreations.of', cause }),
            ),
            (row) => (row === null ? null : { operationId: row.operationId, rootId: row.rootId }),
          ),
      },
    });
    const mover = yield* makeThreadMover({ targets });

    const delivery = yield* makeCommandDelivery({ send: commandSignalSend(threads, harness, wakeUnlessStopped(threads)) });
    yield* Effect.forkScoped(delivery.attend());
    yield* Effect.forkScoped(Effect.asVoid(delivery.resume()));
    const owedRows = yield* makeOwedCallRows;
    const callEndings = yield* makeCallEndings({
      rows: owedRows,
      send: commandSignalSend(threads, harness, wakeUnlessStopped(threads), CALL_RESULT_SIGNAL),
      ended: yield* Queue.unbounded<CallAddress>(),
      withdraw: (threadId, toolCallId, reason) => harness.runs.questions().withdraw(threadId, toolCallId, reason),
    });
    yield* Effect.forkScoped(callEndings.attend());
    yield* Effect.forkScoped(Effect.asVoid(callEndings.resume()));
    const custodyNotices = yield* makeCustodyNotices({
      send: commandSignalSend(threads, harness, stayIdle, TERMINAL_CUSTODY_SIGNAL, true),
    });
    yield* Effect.forkScoped(custodyNotices.attend(custody.displaced, CUSTODY_NOTICE_PASS_MS));
    const remeasure = yield* Remeasure;
    yield* Effect.acquireRelease(
      Effect.sync(() => remeasure.telling(commandSignalSend(threads, harness, stayIdle, RULE_ESCAPED_SIGNAL, true))),
      (release) => Effect.sync(release),
    );
    const worktreeThreads = yield* WorktreeThreads;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        worktreeThreads.stopping((projectId, threadId) =>
          ending.stop(threadId, projectId, undefined, { door: 'worktree-finished' }).pipe(
            Effect.asVoid,
            Effect.mapError((failure) => ({ message: failure.message })),
          ),
        ),
      ),
      (release) => Effect.sync(release),
    );
    const worktreeOwners = yield* WorktreeOwners;
    return Context.make(ThreadList, list)
      .pipe(
        Context.add(OwedCalls, callEndings),
        Context.add(ThreadBirths, births),
        Context.add(NoticeTakeBack, commandNoticeTakeBack(harness, owedRows)),
        Context.add(ThreadTurns, turns),
        Context.add(ThreadRewinds, rewinds),
        Context.add(QuestionAnswers, answers),
        Context.add(Attachments, attachmentOwner),
        Context.add(HarnessRegistry, registry),
        Context.add(ThreadRollouts, rollouts),
        Context.add(Conversations, yield* makeConversationReads),
        Context.add(ThreadAdjustments, adjustments),
        Context.add(ThreadDetachment, detachment),
        Context.add(ThreadTitles, naming),
        Context.add(ThreadPlacement, placement),
        Context.add(ThreadRoots, { rootOf: placement.rootOf }),
        Context.add(ThreadMoves, mover),
        Context.add(ThreadEnding, ending),
        Context.add(ReaderMarking, reader),
        Context.add(MergeNotice, yield* makeMergeNotice),
        Context.add(
          WorktreeUpdates,
          worktreeUpdates(
            worktreeOwners.guards,
            worktreeOwners.gates,
            worktreeThreads,
            (threadId, envelope) => harness.inputs.deliver(threadId, OPERATOR_PRINCIPAL, envelope),
            (projectId, record, title, sender) =>
              births.create({ projectId, createdBySessionId: null, askedBy: sender ?? undefined, worktree: record.rootId, title }).pipe(
                Effect.map((born) => born.thread.id),
                Effect.mapError((failure) =>
                  failure instanceof GateRefusal
                    ? { message: failure.reason, unblock: failure.unblock }
                    : { message: failure.message, unblock: ['hand the update again'] as const },
                ),
              ),
            worktreeOwners.progress,
          ),
        ),
      )
      .pipe(
        Context.add(ThreadRecapWriting, { generate: (threadId, projectId) => recaps.generateNow(threadId, projectId) }),
        Context.add(ThreadDecisions, decisions),
        Context.add(ThreadAsks, threadAsks),
      );
  }),
);
