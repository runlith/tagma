import { Context, Effect, Layer } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { ThreadRollouts as ThreadRolloutsTag } from '../contract/service/rollouts.js';
import { makeSqliteThreadJournal, planHead, type SqliteThreadJournal } from '../journal/log.js';
import type { ThreadEventInsert } from '@runlith/agent/thread/storage/eventLog';
import { programWriteUnit } from '../../platform/store/programs.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { RestedRollouts } from '../contract/service/rested.js';
import { makeConversationReads } from '../journal/conversationReads.js';
import { makeModelChanges } from '../events/modelChanges.js';
import { makeThreadRebinding } from '../harness/rebinding.js';
import { JournalOrder } from '../journal/lane.js';
import { makeHarnessMoves } from '../harness/moves.js';
import { ThreadHomes } from '../contract/service/homes.js';
import { writes } from '../../platform/contract/service/writes.js';

export const harnessMoves = makeHarnessMoves;

import { makeConversationBackfill } from '../journal/conversationBackfill.js';
import {
  makeThreadProjection,
  type ThreadProjection,
  ThreadProjectionRefused as ThreadProjectionRefusedOver,
} from '../journal/projection.js';
import { makeThreadRolloutRepair } from '../journal/repair.js';
import { makeThreadRolloutReport } from '../journal/report.js';
import { makeRestedReads } from '../journal/restedReads.js';
import { makeRolloutForms } from '../journal/rolloutForming.js';
import type { StageRollout } from '../journal/rolloutEntryForms.js';
import { stageRolloutFile } from '../journal/rolloutStaging.js';
import { RolloutReads } from '../contract/service/rolloutReads.js';
import type { JournalEntry } from '../journal/rolloutContext.js';
import { formedThread as formedThreadOver, journalSteps as journalStepsOver } from '../journal/formSteps.js';
import { exportThreadRollout as exportThreadRolloutOver, appendThreadRollout as appendThreadRolloutOver } from '../journal/export.js';
import { rehydrateThreadRecords as rehydrateThreadRecordsOver, replayThreadRollout as replayThreadRolloutOver } from '../journal/replay.js';
import { threadRolloutMeta as threadRolloutMetaOver, rolloutBirth as rolloutBirthOver } from '../journal/rolloutMeta.js';
import { type RolloutBirth, type RolloutWriter, RolloutWriting, rolloutWriter as rolloutWriterOver } from '../journal/rolloutWriter.js';
import { rolloutParticipant as rolloutParticipantOver } from '../journal/rolloutSnapshot.js';
import {
  RolloutUnreadable,
  createRollout as createRolloutOver,
  appendRolloutItem as appendRolloutItemOver,
  replayRollout as replayRolloutOver,
} from '../journal/rolloutFile.js';
import { foldedToolFact as foldedToolFactOver } from '../journal/foldedFacts.js';
import { evictThreadProjection as evictThreadProjectionOver } from '../journal/rest.js';
import { compressRollout as compressRolloutOver } from '../journal/rolloutForms.js';
import { thread as threadTable, threadEntry as threadEntryTable, threadRun as threadRunTable } from '../store/kernel.js';
import {
  conversationWrites,
  threadEvent as threadEventTable,
  threadRolloutCursor as threadRolloutCursorTable,
  threadRolloutForm as threadRolloutFormTable,
  threadRolloutHome as threadRolloutHomeTable,
  threadRolloutRefusal as threadRolloutRefusalTable,
} from '../store/journal.js';
import {
  threadInbox as threadInboxTable,
  threadSeen as threadSeenTable,
  threadResource as threadResourceTable,
  threadTargetOperation as threadTargetOperationTable,
} from '../store/tables.js';
import { externalSession as externalSessionTable } from '../store/harnessFacet.js';
import { threadMandate as threadMandateTable } from '../store/mandate.js';
import { makeThreadTargetOperationStore, ThreadTargetStorageFailed as ThreadTargetStorageFailedOver } from '../store/targetIntents.js';
import type { ThreadTargetOperationNew } from '../store/targetIntents.js';
import { makeThreadInbox } from '../store/inbox.js';
import { makeThreadResourceStore } from '../store/resources.js';
import { makeApprovalPreferences } from '../store/approvals.js';
import { makeSessionLookups } from '../store/sessionLookups.js';
import { makeThreadDirectory } from '../store/directory.js';
import { ThreadBirths as ThreadBirthsTag } from '../birth/acts.js';
import { makePlacementCoordinator, Placing } from '../birth/placement.js';
import { NoteWriting } from '../journal/worktreeNotes.js';
import { Assignments } from '../../workspace/contract/service/assignments.js';
import { Coverage, FileRoots } from '../../workspace/contract/service/roots.js';
import { CoveredRepositories } from '../../workspace/contract/service/repositories.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { WorktreeIntents } from '../../worktrees/contract/service/intents.js';
import { Worktrees } from '../../worktrees/contract/service/creation.js';
import { NewBranches } from '../../worktrees/contract/service/branches.js';
import { UnbornReleasing } from '../../worktrees/contract/service/finishingGate.js';
import { Settings } from '../../settings/contract/service/values.js';
import { makeExternalBirthRows } from '../birth/externalRows.js';
import { resolveDelegation as resolveDelegationOver, republishOnMachineFlip as republishOnMachineFlipOver } from '../birth/delegation.js';
import { makeThreadTeams as makeThreadTeamsOver } from '../team.js';
import { ThreadTeams } from '../contract/service/team.js';
import { NO_REVIEW } from '@runlith/agent/collaboration/team';
import { ThreadTurns as ThreadTurnsTag } from '../turns/acts.js';
import { ThreadRewinds as ThreadRewindsTag } from '../turns/rewinds.js';
import { ThreadAdjustments as ThreadAdjustmentsTag } from '../turns/adjustments.js';
import { QuestionAnswers, makeQuestionAnswers } from '../turns/answers.js';
import { makeReaderMarks } from '../turns/reader.js';
import { ThreadList as ThreadListTag } from '../contract/service/list.js';
import { makeThreadListReads } from '../list/store.js';
import { ActivityRecord } from '@runlith/activity/store/record';
import { ThreadMetadataSource } from '../contract/service/parts.js';
import type { ThreadMetadataReads } from '../contract/service/rows.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { makeThreadLiveSpells } from '../list/liveSpells.js';
import { ThreadPhaseFeed as ThreadPhaseFeedClass } from '../list/phase.js';
import { nativeAsk as nativeAskOver } from '../list/pendingAsk.js';
import { heldSessions as heldSessionsOver } from '../list/select.js';
import type { ThreadSummary } from '../list/summary.js';
import type { ThreadListProjection } from '../list/summary.js';
import type { ThreadsEvent } from '../contract/service/list.js';
import {
  wireThread as wireThreadOver,
  wireThreadFacts as wireThreadFactsOver,
  wireThreadShape as wireThreadShapeOver,
} from '../list/wire.js';
import { wireHarness as wireHarnessOver } from '../voice/rowDetail.js';
import { threadFactsLine as threadFactsLineOver, threadShapeText as threadShapeTextOver } from '../voice/threadText.js';
import { makeThreadMover } from '../targets/moves.js';
import { ThreadMoves as ThreadMovesTag } from '../targets/moves.js';
import { makeThreadTargets } from '../targets/decide.js';
import type { ThreadTargetKernel } from '../targets/decide.js';
import { makeTargetContexts } from '../targets/preparation.js';
import { ThreadTitles as ThreadTitlesTag } from '../contract/service/titles.js';
import { INSTRUCTION as INSTRUCTION_OVER, readThreadTitle as readThreadTitleOver } from '../naming/titles.js';
import { makeThreadAttachments } from '../resources/attachments.js';
import { makeThreadScratch } from '../resources/scratch.js';
import { sandboxHolds as sandboxHoldsOver, sandboxKind as sandboxKindOver } from '../resources/sandbox.js';
import { holdThreadResources as holdThreadResourcesOver } from '../resources/hold.js';
import { terminalsKind as terminalsKindOver } from '../resources/kinds/terminal.js';
import { commandTimes as commandTimesOver, toolTimes as toolTimesOver } from '../../executions/commands/times.js';
import { makeCommandDelivery } from '../collaboration/commandEndings.js';
import { makeCallEndings } from '../collaboration/callEndings.js';
import { HarnessCalls } from '../contract/service/engine.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { makeOwedCallRows } from '../store/owedCalls.js';
import { CallEpoch } from '../contract/service/owedCalls.js';
import { randomUUID } from 'node:crypto';
import { ThreadInbox as ThreadInboxTag } from '../store/inbox.js';

import type { CommandSignalSend } from '../collaboration/commandEndings.js';
import { makeCustodyNotices } from '../collaboration/custodyNotices.js';
import type { CallDebts } from '../../executions/contract/service/notices.js';
import {
  callDebts as callDebtsOver,
  commandNoticeTakeBack as commandNoticeTakeBackOver,
  commandSignalSend as commandSignalSendOver,
  stayIdle as stayIdleOver,
  wakeUnlessStopped as wakeUnlessStoppedOver,
} from '../collaboration/signals.js';
import type { IdleDelivery } from '../collaboration/signals.js';
import { makeOwnWork } from '../collaboration/ownWork.js';
import { makeEventReads } from '../events/reads.js';
import { OwnWork } from '../contract/service/ownWork.js';
import { standingOf } from '../events/standing.js';
import { makeThreadsLifetime } from '../lifetime.js';
import { harnessSpend as harnessSpendOver } from '../store/harnessSpend.js';
import { harnessRefusal as harnessRefusalOver } from '../refusals.js';
import { worktreeUpdates as worktreeUpdatesOver } from '../worktreeUpdates.js';
import { makeMandateRows } from '../mandate.js';
import { assembliesOf as assembliesOfOver, SectionOrderConflict as SectionOrderConflictOver } from '../doctrine/assemblies.js';
import {
  renderSection as renderSectionOver,
  renderSections as renderSectionsOver,
  sectionContext as sectionContextOver,
  SectionValueMissing as SectionValueMissingOver,
} from '../doctrine/render.js';
import {
  SECTIONS as SECTIONS_OVER,
  sectionPath as sectionPathOver,
  contributions as contributionsOver,
  isOwn as isOwnOver,
  ContributionInvalid as ContributionInvalidOver,
} from '../doctrine/registry.js';
import { detect as detectOver } from '../doctrine/sectionText.js';
import {
  makeDeclaredAgents,
  PERSONAL_AGENTS_DIRECTORY as PERSONAL_AGENTS_DIRECTORY_OVER,
  PROJECT_AGENTS_DIRECTORY as PROJECT_AGENTS_DIRECTORY_OVER,
} from '../library/declared.js';
import { NATIVE_CAPABILITIES as NATIVE_CAPABILITIES_OVER } from '@runlith/agent/thread/record';
import { HARNESS_OFFER } from '../contract/wire/harness/seat.js';
import type { Harness, HarnessRegistry } from '../contract/service/harness.js';
import type { NativeThreadState } from '../contract/service/state.js';
import {
  ThreadEvidence as ThreadEvidenceTag,
  EvidenceQueries as EvidenceQueriesTag,
  EvidenceFeed as EvidenceFeedTag,
  CacheWarmth as CacheWarmthTag,
} from '../contract/service/evidence.js';
import { ThreadRefused as ThreadRefusedOver, ThreadInputRefused as ThreadInputRefusedOver } from '../contract/service/failure.js';
import type { WorldAcquire } from '../contract/service/preparation.js';
import { AgentLibrary as AgentLibraryTag } from '../contract/service/library.js';
import {
  unmeasuredObservation as unmeasuredObservationOver,
  currentModel as currentModelOver,
} from '../contract/wire/harness/observation.js';
import type { HarnessObservation } from '../contract/wire/harness/observation.js';
import type { HarnessBinding, HarnessField } from '../contract/wire/harness/observation.js';
import { HARNESS_AGENT_ID as HARNESS_AGENT_ID_OVER } from '../contract/wire/harness/names.js';
import type { HarnessName } from '../contract/wire/harness/names.js';
import type { HarnessSession } from '../contract/wire/harness/session.js';
import {
  launchedExecution as launchedExecutionOver,
  parseExternalSession as parseExternalSessionOver,
} from '../contract/wire/harness/externalSession.js';
import type { HarnessInstall, ExternalSession } from '../contract/wire/harness/externalSession.js';
import { AGENT_IDLE_MS as AGENT_IDLE_MS_OVER } from '@runlith/agent/callProgress';
import {
  LEASE_RHYTHM as LEASE_RHYTHM_OVER,
  REAPER_RHYTHM as REAPER_RHYTHM_OVER,
  RECONCILE_INTERVAL_MS as RECONCILE_INTERVAL_MS_OVER,
  SETTLEMENT_RHYTHM as SETTLEMENT_RHYTHM_OVER,
} from '../contract/wire/rhythm.js';
import { LIST_WINDOW_ROWS as LIST_WINDOW_ROWS_OVER } from '../contract/wire/list.js';
import { THREAD_OPERATION_IDS as THREAD_OPERATION_IDS_OVER } from '../contract/wire/operations/catalog.js';
import { ThreadTargetOperationKey as ThreadTargetOperationKeySchema, rootOf as rootOfOver } from '../contract/wire/target.js';
import type { WarmthBasis } from '../contract/wire/warmth.js';
import type { ThreadToolAnswer } from '../contract/wire/evidenceInput.js';
import { threadToolText as threadToolTextOver } from '../voice/answers.js';
import type { EvidenceAnswer, ExpandedRecord, ThreadShape } from '../contract/wire/evidence.js';
import { idleProjectionDays as idleProjectionDaysOver, agentsOffered as agentsOfferedOver } from '../contract/wire/settings.js';
import type { CommandSignalOutcome } from '../collaboration/commandEndings.js';
import { threadJournalLane as threadJournalLaneOver } from '@runlith/agent/thread/transition/lane';
import { ThreadEntryKinds, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';

export const modelChanges = () => makeModelChanges;

export const threadRebinding = Effect.fnUntraced(function* () {
  const lane = yield* threadJournalLaneOver;
  return yield* Effect.provideService(makeThreadRebinding, JournalOrder, lane);
});

export const thread = () => threadTable;

export const threadEntry = () => threadEntryTable;

export const threadRun = () => threadRunTable;

export const threadEvent = () => threadEventTable;

export const threadRolloutCursor = () => threadRolloutCursorTable;

export const threadRolloutRefusal = () => threadRolloutRefusalTable;

export const threadRolloutForm = () => threadRolloutFormTable;

export const threadRolloutHome = () => threadRolloutHomeTable;

export const threadInbox = () => threadInboxTable;

export const externalSession = () => externalSessionTable;

export const threadSeen = () => threadSeenTable;

export const threadResource = () => threadResourceTable;

export const threadTargetOperation = () => threadTargetOperationTable;

export const threadMandate = () => threadMandateTable;

export const threadTargetOperationStore = () => makeThreadTargetOperationStore;

export const threadInboxStore = (kinds: ThreadEntryReader) => Effect.provideService(makeThreadInbox, ThreadEntryKinds, kinds);

export const threadResourceStore = () => makeThreadResourceStore;

export const approvalPreferences = () => makeApprovalPreferences;

export const heldSessionsSql = () => heldSessionsOver;

export const sessionLookups = () => makeSessionLookups;

export const threadDirectoryStore = (kinds: ThreadEntryReader) => Effect.provideService(makeThreadDirectory, ThreadEntryKinds, kinds);

export const placementCoordinator = () => makePlacementCoordinator;

const unreadSync = (method: string): never => {
  throw new Error(method);
};

export const placementDoubles = Layer.mergeAll(
  Layer.mock(MachineUnits, {}),
  Layer.mock(Assignments, {}),
  Layer.mock(FileRoots, { namespaceId: NamespaceId.make('placement-test'), scope: () => unreadSync('FileRoots.scope') }),
  Layer.mock(WorktreeRecords, {}),
  Layer.mock(WorktreeIntents, {}),
  Layer.mock(Coverage, { onCovered: () => unreadSync('Coverage.onCovered'), recorded: () => unreadSync('Coverage.recorded') }),
  Layer.mock(CoveredRepositories, {}),
  Layer.mock(Worktrees, { onRecorded: () => unreadSync('Worktrees.onRecorded') }),
  Layer.mock(NewBranches, {}),
  Layer.mock(Settings, {}),
  Layer.mock(UnbornReleasing, { release: () => unreadSync('UnbornReleasing.release') }),
);

export const externalBirthRows = () => makeExternalBirthRows;

export const resolveDelegation = (...input: Parameters<typeof resolveDelegationOver>): ReturnType<typeof resolveDelegationOver> =>
  resolveDelegationOver(...input);

export const republishOnMachineFlip = (
  ...input: Parameters<typeof republishOnMachineFlipOver>
): ReturnType<typeof republishOnMachineFlipOver> => republishOnMachineFlipOver(...input);

export const readerMarks = () => makeReaderMarks;

export const standingOfSummary = (...input: Parameters<typeof standingOf>): ReturnType<typeof standingOf> => standingOf(...input);

export const owingNothing: OwnWork['Service'] = OwnWork.of({ owing: () => Effect.succeed([]), endings: new Set() });

export const threadListReads = (
  threads: ThreadMetadataReads,
  records: ThreadRecords['Service'],
  kinds: ThreadEntryReader,
  own: OwnWork['Service'] = owingNothing,
) =>
  makeThreadListReads.pipe(
    Effect.provideService(ThreadMetadataSource, threads),
    Effect.provideService(ThreadRecords, records),
    Effect.provideService(ThreadEntryKinds, kinds),
    Effect.provideService(OwnWork, own),
    Effect.provide(Layer.mock(ActivityRecord, {})),
  );

export const threadLiveSpells = () => makeThreadLiveSpells;

export const threadPhaseFeed = (...input: ConstructorParameters<typeof ThreadPhaseFeedClass>): ThreadPhaseFeedClass =>
  new ThreadPhaseFeedClass(...input);

export const nativeAsk = (...input: Parameters<typeof nativeAskOver>): ReturnType<typeof nativeAskOver> => nativeAskOver(...input);

export const threadMover = (...input: Parameters<typeof makeThreadMover>) => makeThreadMover(...input);

export const moverDoubles = (placement: Placing['Service']) =>
  Context.make(Placing, placement).pipe(
    Context.add(
      NoteWriting,
      NoteWriting.of({
        created: () => Effect.die('NoteWriting.created'),
        setup: () => Effect.die('NoteWriting.setup'),
        moved: () => Effect.void,
        merged: () => Effect.die('NoteWriting.merged'),
      }),
    ),
    Context.add(
      ThreadHomes,
      ThreadHomes.of({
        writes: writes('testing/thread-homes', []),
        admit: () => Effect.die('ThreadHomes.admit'),
        move: () => Effect.die('ThreadHomes.move'),
      }),
    ),
  );

export const threadTargets = (...input: Parameters<typeof makeThreadTargets>) => makeThreadTargets(...input);

export const targetContexts = () => makeTargetContexts;

export const threadAttachmentStore = (root: string) => makeThreadAttachments({ root });

export const threadScratch = (root: string) => makeThreadScratch({ root });

export const custodyNotices = (...input: Parameters<typeof makeCustodyNotices>) => makeCustodyNotices(...input);

export const commandDelivery = (...input: Parameters<typeof makeCommandDelivery>) => makeCommandDelivery(...input);

export const owedCallRows = () => makeOwedCallRows;

export const callEndings = (
  units: MachineUnits['Service'],
  send: Parameters<typeof makeCallEndings>[0]['send'],
  ended: Parameters<typeof makeCallEndings>[0]['ended'],
  calls: HarnessCalls['Service'],
  withdraw: Parameters<typeof makeCallEndings>[0]['withdraw'] = () => Effect.die('No question of a call is withdrawn in this scenario.'),
  epoch: string = randomUUID(),
) =>
  Effect.flatMap(makeOwedCallRows, (rows) =>
    makeCallEndings({ rows, send, ended, withdraw }).pipe(
      Effect.provideService(MachineUnits, units),
      Effect.provideService(HarnessCalls, calls),
      Effect.provideService(CallEpoch, { id: epoch }),
    ),
  );

export const sqliteThreadJournal = (rested?: RestedRollouts['Service']) =>
  rested === undefined ? makeSqliteThreadJournal : Effect.provideService(makeSqliteThreadJournal, RestedRollouts, rested);

export const filedThreadJournal = (writer: RolloutWriter) => Effect.provideService(makeSqliteThreadJournal, RolloutWriting, writer);

export const appendedInProgram = (
  units: MachineUnits['Service'],
  journal: SqliteThreadJournal,
  threadId: string,
  head: number,
  events: readonly ThreadEventInsert[],
) =>
  units.program(
    writes('testing.appendedInProgram', [threadEventTable, threadTable, threadRecord], conversationWrites),
    `testing:${threadId}:${head}`,
    (program) => {
      planHead(program, threadId, head);
      const unit = programWriteUnit(program);
      return Effect.forEach(events, (event) => journal.append(event, unit), { discard: true });
    },
  );

export const conversationReads = () => makeConversationReads;

export const conversationBackfill = (journal: SqliteThreadJournal) => makeConversationBackfill({ journal });

export const rolloutWriter = (
  pathOf: (projectId: number, threadId: string) => string | undefined,
  birth: RolloutBirth | null,
  pendingDir?: string,
): RolloutWriter => rolloutWriterOver({ pathOf, birth, pendingDir });

export const rolloutBirth = (...input: Parameters<typeof rolloutBirthOver>): ReturnType<typeof rolloutBirthOver> =>
  rolloutBirthOver(...input);

export const stagedHere: StageRollout = (files, stage) =>
  Effect.flatMap(ThreadEntryKinds, (kinds) =>
    Effect.flatMap(RolloutReads, (read) =>
      Effect.tryPromise({
        try: () => stageRolloutFile(files, stage, kinds, read),
        catch: (error) =>
          new RolloutUnreadable({ reason: 'io', path: files.path, message: error instanceof Error ? error.message : String(error) }),
      }),
    ),
  );

export const restedReads = (
  kinds: ThreadEntryReader,
  home: string | undefined,
  lagging: (threadId: string) => void = () => {},
  stage: StageRollout = stagedHere,
) =>
  Effect.flatMap(makeRolloutForms({ journal: (_threadId, work) => work, stage }), (forms) =>
    makeRestedReads({ forms, home, lagging }),
  ).pipe(Effect.provideService(ThreadEntryKinds, kinds));

export const rolloutForms = (journal: JournalEntry, kinds: ThreadEntryReader, stage: StageRollout = stagedHere) =>
  Effect.provideService(makeRolloutForms({ journal, stage }), ThreadEntryKinds, kinds);

export const journalSteps = (...input: Parameters<typeof journalStepsOver>): ReturnType<typeof journalStepsOver> =>
  journalStepsOver(...input);

export const formedThread = (...input: Parameters<typeof formedThreadOver>): ReturnType<typeof formedThreadOver> =>
  formedThreadOver(...input);

export const threadProjection = (kinds: ThreadEntryReader) => Effect.provideService(makeThreadProjection, ThreadEntryKinds, kinds);

export const threadRolloutRepair = (kinds: ThreadEntryReader) => Effect.provideService(makeThreadRolloutRepair, ThreadEntryKinds, kinds);

export const threadRolloutReport = (projection: ThreadProjection) => makeThreadRolloutReport({ projection });

export const mandateRows = () => makeMandateRows;

export const questionAnswers = () => makeQuestionAnswers;

export const addQuestionAnswers =
  (service: QuestionAnswers['Service']) =>
  (context: Context.Context<never>): Context.Context<QuestionAnswers> =>
    Context.add(context, QuestionAnswers, service);

export const commandTimes = (...input: Parameters<typeof commandTimesOver>): ReturnType<typeof commandTimesOver> =>
  commandTimesOver(...input);

export const toolTimes = (...input: Parameters<typeof toolTimesOver>): ReturnType<typeof toolTimesOver> => toolTimesOver(...input);

export const harnessRefusal: typeof harnessRefusalOver = (work, admitted) => harnessRefusalOver(work, admitted);

export const worktreeUpdates = (...input: Parameters<typeof worktreeUpdatesOver>): ReturnType<typeof worktreeUpdatesOver> =>
  worktreeUpdatesOver(...input);

export const harnessSpend = (...input: Parameters<typeof harnessSpendOver>): ReturnType<typeof harnessSpendOver> =>
  harnessSpendOver(...input);

export const threadsLifetime = (...input: Parameters<typeof makeThreadsLifetime>) => makeThreadsLifetime(...input);

export const rolloutParticipant = (...input: Parameters<typeof rolloutParticipantOver>): ReturnType<typeof rolloutParticipantOver> =>
  rolloutParticipantOver(...input);

export const createRollout = (...input: Parameters<typeof createRolloutOver>): ReturnType<typeof createRolloutOver> =>
  createRolloutOver(...input);

export const appendRolloutItem = (...input: Parameters<typeof appendRolloutItemOver>): ReturnType<typeof appendRolloutItemOver> =>
  appendRolloutItemOver(...input);

export const replayRollout = (...input: Parameters<typeof replayRolloutOver>): ReturnType<typeof replayRolloutOver> =>
  replayRolloutOver(...input);

export const exportThreadRollout = (...input: Parameters<typeof exportThreadRolloutOver>): ReturnType<typeof exportThreadRolloutOver> =>
  exportThreadRolloutOver(...input);

export const appendThreadRollout = (...input: Parameters<typeof appendThreadRolloutOver>): ReturnType<typeof appendThreadRolloutOver> =>
  appendThreadRolloutOver(...input);

export const rehydrateThreadRecords = (
  ...input: Parameters<typeof rehydrateThreadRecordsOver>
): ReturnType<typeof rehydrateThreadRecordsOver> => rehydrateThreadRecordsOver(...input);

export const replayThreadRollout = (...input: Parameters<typeof replayThreadRolloutOver>): ReturnType<typeof replayThreadRolloutOver> =>
  replayThreadRolloutOver(...input);

export const threadRolloutMeta = (...input: Parameters<typeof threadRolloutMetaOver>): ReturnType<typeof threadRolloutMetaOver> =>
  threadRolloutMetaOver(...input);

export const foldedToolFact = (...input: Parameters<typeof foldedToolFactOver>): ReturnType<typeof foldedToolFactOver> =>
  foldedToolFactOver(...input);

export const evictThreadProjection = (
  ...input: Parameters<typeof evictThreadProjectionOver>
): ReturnType<typeof evictThreadProjectionOver> => evictThreadProjectionOver(...input);

export const compressRollout = (...input: Parameters<typeof compressRolloutOver>): ReturnType<typeof compressRolloutOver> =>
  compressRolloutOver(...input);

export const wireThread = (...input: Parameters<typeof wireThreadOver>): ReturnType<typeof wireThreadOver> => wireThreadOver(...input);

export const wireHarness = (...input: Parameters<typeof wireHarnessOver>): ReturnType<typeof wireHarnessOver> => wireHarnessOver(...input);

export const wireThreadFacts = (...input: Parameters<typeof wireThreadFactsOver>): ReturnType<typeof wireThreadFactsOver> =>
  wireThreadFactsOver(...input);

export const wireThreadShape = (...input: Parameters<typeof wireThreadShapeOver>): ReturnType<typeof wireThreadShapeOver> =>
  wireThreadShapeOver(...input);

export const threadFactsLine = (...input: Parameters<typeof threadFactsLineOver>): ReturnType<typeof threadFactsLineOver> =>
  threadFactsLineOver(...input);

export const threadShapeText = (...input: Parameters<typeof threadShapeTextOver>): ReturnType<typeof threadShapeTextOver> =>
  threadShapeTextOver(...input);

export const readThreadTitle = (...input: Parameters<typeof readThreadTitleOver>): ReturnType<typeof readThreadTitleOver> =>
  readThreadTitleOver(...input);

export const INSTRUCTION = () => INSTRUCTION_OVER;

export const declaredAgents = (...input: Parameters<typeof makeDeclaredAgents>) => makeDeclaredAgents(...input);

export const PERSONAL_AGENTS_DIRECTORY = () => PERSONAL_AGENTS_DIRECTORY_OVER;

export const PROJECT_AGENTS_DIRECTORY = () => PROJECT_AGENTS_DIRECTORY_OVER;

export const EXTERNAL_CAPABILITIES = () => HARNESS_OFFER;

export const NATIVE_CAPABILITIES = () => NATIVE_CAPABILITIES_OVER;

export const holdThreadResources = (...input: Parameters<typeof holdThreadResourcesOver>): ReturnType<typeof holdThreadResourcesOver> =>
  holdThreadResourcesOver(...input);

export const sandboxHolds = (...input: Parameters<typeof sandboxHoldsOver>): ReturnType<typeof sandboxHoldsOver> =>
  sandboxHoldsOver(...input);

export const sandboxKind = (...input: Parameters<typeof sandboxKindOver>): ReturnType<typeof sandboxKindOver> => sandboxKindOver(...input);

export const terminalsKind = (...input: Parameters<typeof terminalsKindOver>): ReturnType<typeof terminalsKindOver> =>
  terminalsKindOver(...input);

export const callDebts = () => Effect.map(makeOwedCallRows, (rows): CallDebts => callDebtsOver(rows));

export const commandNoticeTakeBack = (harness: Parameters<typeof commandNoticeTakeBackOver>[0]) =>
  Effect.map(makeOwedCallRows, (rows) => commandNoticeTakeBackOver(harness, rows));

export const commandSignalSend = (...input: Parameters<typeof commandSignalSendOver>): ReturnType<typeof commandSignalSendOver> =>
  commandSignalSendOver(...input);

export const stayIdle = (...input: Parameters<typeof stayIdleOver>): ReturnType<typeof stayIdleOver> => stayIdleOver(...input);

export const wakeUnlessStopped = (...input: Parameters<typeof wakeUnlessStoppedOver>): ReturnType<typeof wakeUnlessStoppedOver> =>
  wakeUnlessStoppedOver(...input);

export const assembliesOf = (...input: Parameters<typeof assembliesOfOver>): ReturnType<typeof assembliesOfOver> =>
  assembliesOfOver(...input);

export const isSectionOrderConflict = (error: unknown): error is SectionOrderConflictOver => error instanceof SectionOrderConflictOver;

export const SECTIONS = () => SECTIONS_OVER;

export const renderSection = (...input: Parameters<typeof renderSectionOver>): ReturnType<typeof renderSectionOver> =>
  renderSectionOver(...input);

export const renderSections = (...input: Parameters<typeof renderSectionsOver>): ReturnType<typeof renderSectionsOver> =>
  renderSectionsOver(...input);

export const sectionContext = (...input: Parameters<typeof sectionContextOver>): ReturnType<typeof sectionContextOver> =>
  sectionContextOver(...input);

export const contributions = (...input: Parameters<typeof contributionsOver>): ReturnType<typeof contributionsOver> =>
  contributionsOver(...input);

export const isOwn = (id: Parameters<typeof isOwnOver>[0]): id is keyof typeof SECTIONS_OVER => isOwnOver(id);

export const sectionPath = (...input: Parameters<typeof sectionPathOver>): ReturnType<typeof sectionPathOver> => sectionPathOver(...input);

export const detect = (...input: Parameters<typeof detectOver>): ReturnType<typeof detectOver> => detectOver(...input);

export const birthsOf = (owners: Context.Context<ThreadBirthsTag>): ThreadBirthsTag['Service'] => Context.get(owners, ThreadBirthsTag);

export const turnsOf = (owners: Context.Context<ThreadTurnsTag>): ThreadTurnsTag['Service'] => Context.get(owners, ThreadTurnsTag);

export const rewindsOf = (owners: Context.Context<ThreadRewindsTag>): ThreadRewindsTag['Service'] => Context.get(owners, ThreadRewindsTag);

export const listOf = (owners: Context.Context<ThreadListTag>): ThreadListTag['Service'] => Context.get(owners, ThreadListTag);

export const adjustmentsOf = (owners: Context.Context<ThreadAdjustmentsTag>): ThreadAdjustmentsTag['Service'] =>
  Context.get(owners, ThreadAdjustmentsTag);

export const rolloutsOf = (owners: Context.Context<ThreadRolloutsTag>): ThreadRolloutsTag['Service'] =>
  Context.get(owners, ThreadRolloutsTag);

export const inboxOf = (owners: Context.Context<ThreadInboxTag>): ThreadInboxTag['Service'] => Context.get(owners, ThreadInboxTag);

export const titlesOf = (owners: Context.Context<ThreadTitlesTag>): ThreadTitlesTag['Service'] => Context.get(owners, ThreadTitlesTag);

export const answersOf = (owners: Context.Context<QuestionAnswers>): QuestionAnswers['Service'] => Context.get(owners, QuestionAnswers);

export const movesOf = (owners: Context.Context<ThreadMovesTag>): ThreadMovesTag['Service'] => Context.get(owners, ThreadMovesTag);

export const asCommandSignalSend = (value: CommandSignalSend): CommandSignalSend => value;

export const asIdleDelivery = (value: IdleDelivery): IdleDelivery => value;

export const ownWork = () => makeOwnWork;

export const eventReads = () => makeEventReads;

export const asThreadTargetOperationNew = (value: ThreadTargetOperationNew): ThreadTargetOperationNew => value;

export const asThreadTargetKernel = (value: ThreadTargetKernel): ThreadTargetKernel => value;

export const asHarnessService = (value: Harness['Service']): Harness['Service'] => value;

export const asHarnessRegistryService = (value: HarnessRegistry['Service']): HarnessRegistry['Service'] => value;

export const asThreadSummary = (value: ThreadSummary): ThreadSummary => value;

export const asThreadListProjection = (value: unknown): ThreadListProjection => value as ThreadListProjection;

export const asThreadsEvent = (value: unknown): ThreadsEvent => value as ThreadsEvent;

export const isThreadProjectionRefused = (failure: unknown): failure is ThreadProjectionRefusedOver =>
  failure instanceof ThreadProjectionRefusedOver;

export const isSectionValueMissing = (error: unknown): boolean => error instanceof SectionValueMissingOver;

export const isContributionInvalid = (error: unknown): boolean => error instanceof ContributionInvalidOver;

export const isThreadTargetStorageFailed = (failure: unknown): failure is ThreadTargetStorageFailedOver =>
  failure instanceof ThreadTargetStorageFailedOver;

export const failsWith = (run: () => void, matches: (error: unknown) => boolean): boolean => {
  try {
    run();
    return false;
  } catch (error) {
    return matches(error);
  }
};

export const evidenceOf = (owners: Context.Context<ThreadEvidenceTag>): ThreadEvidenceTag['Service'] =>
  Context.get(owners, ThreadEvidenceTag);

export const evidenceQueriesOf = (owners: Context.Context<EvidenceQueriesTag>): EvidenceQueriesTag['Service'] =>
  Context.get(owners, EvidenceQueriesTag);

export const evidenceFeedOf = (owners: Context.Context<EvidenceFeedTag>): EvidenceFeedTag['Service'] =>
  Context.get(owners, EvidenceFeedTag);

export const threadEvidenceTag = () => ThreadEvidenceTag;

export const evidenceQueriesTag = () => EvidenceQueriesTag;

export const cacheWarmthTag = () => CacheWarmthTag;

export const threadRolloutsTag = () => ThreadRolloutsTag;

export const agentLibraryTag = () => AgentLibraryTag;

export const asThreadEvidence = (value: ThreadEvidenceTag): ThreadEvidenceTag => value;

export const asEvidenceQueries = (value: EvidenceQueriesTag): EvidenceQueriesTag => value;

export const asCacheWarmth = (value: CacheWarmthTag): CacheWarmthTag => value;

export const asThreadRollouts = (value: ThreadRolloutsTag): ThreadRolloutsTag => value;

export const asAgentLibrary = (value: AgentLibraryTag): AgentLibraryTag => value;

export const asNativeThreadState = (value: NativeThreadState): NativeThreadState => value;

export const asWorldAcquire = (value: WorldAcquire): WorldAcquire => value;

export const asHarnessName = (value: HarnessName): HarnessName => value;

export const asHarnessSession = (value: HarnessSession): HarnessSession => value;

export const asHarnessInstall = (value: HarnessInstall): HarnessInstall => value;

export const asHarnessObservation = (value: HarnessObservation): HarnessObservation => value;

export const asHarnessBinding = (value: HarnessBinding): HarnessBinding => value;

export const asHarnessField = (value: HarnessField): HarnessField => value;

export const asExternalSession = (value: ExternalSession): ExternalSession => value;

export const asThreadToolAnswer = (value: ThreadToolAnswer): ThreadToolAnswer => value;

export const threadToolText = (...input: Parameters<typeof threadToolTextOver>): ReturnType<typeof threadToolTextOver> =>
  threadToolTextOver(...input);

export const asEvidenceAnswer = (value: EvidenceAnswer): EvidenceAnswer => value;

export const asExpandedRecord = (value: ExpandedRecord): ExpandedRecord => value;

export const asThreadShape = (value: ThreadShape): ThreadShape => value;

export const asWarmthBasis = (value: WarmthBasis): WarmthBasis => value;

export const asThreadInputRefused = (value: ThreadInputRefusedOver): ThreadInputRefusedOver => value;

export const asThreadRefused = (value: ThreadRefusedOver): ThreadRefusedOver => value;

export const asCommandSignalOutcome = (value: CommandSignalOutcome): CommandSignalOutcome => value;

export const isThreadInputRefused = (cause: unknown): cause is ThreadInputRefusedOver => cause instanceof ThreadInputRefusedOver;

export const isThreadRefused = (failure: unknown): failure is ThreadRefusedOver => failure instanceof ThreadRefusedOver;

export const unmeasuredObservation = (
  ...input: Parameters<typeof unmeasuredObservationOver>
): ReturnType<typeof unmeasuredObservationOver> => unmeasuredObservationOver(...input);

export const currentModel = (...input: Parameters<typeof currentModelOver>): ReturnType<typeof currentModelOver> =>
  currentModelOver(...input);

export const HARNESS_AGENT_ID = () => HARNESS_AGENT_ID_OVER;

export const launchedExecution = (...input: Parameters<typeof launchedExecutionOver>): ReturnType<typeof launchedExecutionOver> =>
  launchedExecutionOver(...input);

export const parseExternalSession = (...input: Parameters<typeof parseExternalSessionOver>): ReturnType<typeof parseExternalSessionOver> =>
  parseExternalSessionOver(...input);

export const AGENT_IDLE_MS = () => AGENT_IDLE_MS_OVER;

export const LEASE_RHYTHM = () => LEASE_RHYTHM_OVER;

export const REAPER_RHYTHM = () => REAPER_RHYTHM_OVER;

export const RECONCILE_INTERVAL_MS = () => RECONCILE_INTERVAL_MS_OVER;

export const SETTLEMENT_RHYTHM = () => SETTLEMENT_RHYTHM_OVER;

export const LIST_WINDOW_ROWS = () => LIST_WINDOW_ROWS_OVER;

export const THREAD_OPERATION_IDS = () => THREAD_OPERATION_IDS_OVER;

export const threadTargetOperationKey = () => ThreadTargetOperationKeySchema;

export const rootOf = (...input: Parameters<typeof rootOfOver>): ReturnType<typeof rootOfOver> => rootOfOver(...input);

export const idleProjectionDays = () => idleProjectionDaysOver;

export const agentsOffered = () => agentsOfferedOver;

export const journalLane = (): typeof threadJournalLaneOver => threadJournalLaneOver;

export const makeThreadTeams = () => makeThreadTeamsOver;

export const teamLess: ThreadTeams['Service'] = ThreadTeams.of({
  layers: () =>
    Effect.succeed({
      edits: [],
      review: NO_REVIEW,
      thread: { own: null, nearest: null },
      connected: { revision: 0, providers: new Set() },
    }),
  of: () => Effect.die('a thread with no team never resolves one'),
  set: () => Effect.die('a thread with no team is given none'),
  promote: () => Effect.die('a thread with no team promotes none'),
  adopt: () => Effect.die('a thread with no team adopts none'),
});
