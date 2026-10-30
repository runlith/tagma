import { Cause, Context, Effect, FiberMap, FileSystem, Layer, PubSub, Stream } from 'effect';
import { declaredForLaunch } from './installs/upgrade.js';
import type { ProjectDeclaring } from './sessions/launch.js';
import { GrantSigner } from '../platform/contract/service/grantSigner.js';
import { HarnessAccounts } from '../providers/contract/service/harness.js';
import { ProviderRegistry } from '../providers/contract/service/registry.js';
import { AccountQuota } from '../providers/contract/service/quota.js';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { TerminalAdopters } from '../executions/contract/service/adopters.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Settings } from '../settings/contract/service/values.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { NotesReach } from '../threads/contract/service/notes.js';
import { notesReach } from './notesReach.js';
import { ScratchAreas } from '../threads/contract/service/scratch.js';
import { ThreadInbox } from '../threads/store/inbox.js';
import { Attachments } from '../threads/contract/service/attachments.js';
import { OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { failedAs, threadCallFailed } from '../threads/contract/service/failure.js';
import { Worlds } from '../executions/contract/service/worlds.js';
import { Placing } from '../threads/birth/placement.js';
import { HarnessOwner, NativeStorage, ThreadHarness } from '../threads/contract/service/engine.js';
import { HarnessAsides } from '../threads/contract/service/asides.js';
import { ThreadList } from '../threads/contract/service/list.js';
import { ThreadLookup, ThreadReading, ThreadRunning } from '../threads/contract/service/reads.js';
import { ThreadTitles } from '../threads/contract/service/titles.js';
import { ReaderMarking } from '../threads/turns/reader.js';
import { SessionLookupStore } from '../threads/store/sessionLookups.js';
import type { HarnessSession } from '../threads/contract/wire/harness/session.js';
import { Discharge } from '../executions/contract/service/discharge.js';
import { TerminalEndings as ExecutionEndings } from '../executions/contract/service/endings.js';
import { HostManagement } from '../executions/contract/service/host.js';
import { ExecutionProcessEvidence, ExecutionRecords, TerminalScreens } from '../executions/contract/service/records.js';
import { TerminalGrants } from '../executions/contract/service/grants.js';
import { TerminalRequests, Terminals } from '../executions/contract/service/terminals.js';
import { TerminalWriting } from '../executions/contract/service/writing.js';
import { Environments } from '../workspace/contract/service/environments.js';
import { HarnessAdoption } from './contract/service/adoption.js';
import { HarnessPermissions } from './contract/service/permissions.js';
import { HarnessAdapters } from './contract/service/adapters.js';
import { harnessIdentity } from './sessionPrefix.js';
import { HarnessReports } from './contract/service/reports.js';
import { HarnessImplementations } from './contract/service/sessionPorts.js';
import { HarnessSpeech, ScreenAsks } from './contract/service/speech.js';
import { TransportSwitch } from './contract/service/transport.js';
import { transportSwitch } from './sessions/switch.js';
import { WorkSpells } from '../thread-record/contract/service/spells.js';
import type { AdoptionList } from './contract/service/adoptionList.js';
import type { AdoptionPlacement } from './contract/service/adoptionPlacement.js';
import type { SessionMessages } from './contract/service/messages.js';
import { harnessJudging } from './asks/decision.js';
import { askLedger, openTerminalQuestions } from './asks/ledger.js';
import { terminalFaces } from './asks/faces.js';
import { terminalPermissions } from './asks/permissions.js';
import { TerminalAsks } from './asks/terminal.js';
import { TerminalJournal } from './terminal/journal.js';
import { TerminalEndings } from './terminal/endings.js';
import { TerminalClosing } from './terminal/closing.js';
import { TerminalEvents } from './terminal/events.js';
import { makeTerminalCommands } from './terminal/commands.js';
import { OpenRuns } from './terminal/open.js';
import { makeHookGuidance } from './guidance.js';
import { makeGuidanceSources } from './guidanceSources.js';
import { makeSessionPlace } from './sessions/place.js';
import { HarnessGuidance } from './contract/service/guidance.js';
import { TerminalRuns } from './terminal/runs.js';
import { TerminalInterrupts } from './terminal/interrupts.js';
import { ComposerDrafts } from './terminal/drafts.js';
import { TerminalWatch } from './terminal/watch.js';
import { terminalTransport } from './terminal/transport.js';
import { TerminalWords } from './terminal/words.js';
import { HarnessScreenAsks } from './asks/screen.js';
import { makeAdoption } from './adoption/adopt.js';
import { makeSessionBirths } from './birth/sessionBirths.js';
import { externalHarness } from './contribution.js';
import { makeSessionMetadata, SessionMetadata } from './metadata/harnessMetadata.js';
import { HarnessObservations } from './observations/admission.js';
import { SessionObservations } from './contract/service/observations.js';
import { SessionDriver } from './sessions/drive.js';
import { makeSessionAlignment } from './sessions/alignment.js';
import { makeSessionCarrying } from './sessions/carry.js';
import { makeTerminalHistory } from './terminal/history.js';
import { ProtocolDriver } from './protocol/driver.js';
import { RunActivities } from './protocol/activities.js';
import { ActivityLog } from '@runlith/activity/log';
import { protocolStates } from './protocol/diagnosis.js';
import { HostedOpenings, ProtocolStates } from './contract/service/protocol.js';
import { WorkPlaces } from '../threads/contract/service/working.js';
import { ProjectPolicy } from '../graph/contract/service/serving.js';
import { ProtocolRows } from './store/protocol.js';
import { VendorTurns } from './store/turns.js';
import { CompactionPlanning } from '../threads/contract/service/compaction.js';
import { ThreadRebinding } from '../threads/contract/service/rebinding.js';
import { AttachmentFiles } from '../threads/resources/attachments.js';
import { harnessSpend } from '../threads/store/harnessSpend.js';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { makeProtocolWords } from './protocol/words.js';
import { ProtocolJournal } from './protocol/journal.js';
import { acpTransport } from './protocol/transport.js';
import { HarnessSessions } from './contract/service/sessions.js';
import { HarnessLanes } from './sessions/lanes.js';
import { harnessSpeech, screenTexts } from './sessions/speech.js';
import { cliTitles } from './titles.js';
import { harnessTitle } from './settings.js';
import { HarnessSessionStore } from './store/sessions.js';
import { makeSessionRows } from './store/rows.js';
import { entryCommand } from '../installation/contract/wire/junction.js';
import { InstalledHarnesses } from '../threads/contract/service/harness.js';
import { harnessTerminals } from './sessions/programs.js';
import { ModelChanges } from '../threads/contract/service/modelChanges.js';

export const externalHarnessesLayer = Layer.effectContext(
  Effect.gen(function* () {
    const { db } = yield* MachineStore;
    const units = yield* MachineUnits;
    const spells = yield* WorkSpells;
    const records = yield* ThreadRecords;
    const models = yield* ModelChanges;
    const lookup = yield* ThreadLookup;
    const reading = yield* ThreadReading;
    const threads = { ...lookup, ...(yield* ThreadRunning) };
    const inbox = yield* ThreadInbox;
    const terminals = harnessTerminals(yield* Terminals, yield* InstalledHarnesses);
    const grants = yield* TerminalGrants;
    const screens = yield* TerminalScreens;
    const writing = yield* TerminalWriting;
    const executionRecords = yield* ExecutionRecords;
    const requests = yield* TerminalRequests;
    const evidence = yield* ExecutionProcessEvidence;
    const discharge = yield* Discharge;
    const host = yield* HostManagement;
    const environments = yield* Environments;
    const scratch = yield* ScratchAreas;
    const settings = yield* Settings;
    const grantSigner = yield* GrantSigner;
    const accounts = yield* HarnessAccounts;
    const providers = yield* ProviderRegistry;
    const quota = yield* AccountQuota;
    const cli = entryCommand(process.env);
    const policy = yield* ProjectPolicy;
    const files = yield* FileSystem.FileSystem;
    const adapters = yield* HarnessAdapters;
    const declaring: ProjectDeclaring = (name, projectId, root) =>
      Effect.flatMap(policy.read([projectId]), (found) => {
        const row = found.get(projectId);
        return row === undefined ? Effect.void : Effect.asVoid(declaredForLaunch(name, row.private, root, cli));
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.provideService(HarnessAdapters, adapters),
        Effect.mapError(threadCallFailed),
      );
    const lookups = yield* SessionLookupStore;
    const harness = yield* ThreadHarness;
    const list = yield* ThreadList;
    const placing = yield* Placing;
    const worlds = yield* Worlds;
    const titles = yield* ThreadTitles;
    const readerMarking = yield* ReaderMarking;
    const messages: SessionMessages = { deliver: (threadId, principal, envelope) => harness.inputs.deliver(threadId, principal, envelope) };
    const adoptionList: AdoptionList = {
      advanceReaderOrder: (threadId) => reading.advanceReaderOrder(threadId),
      announce: (threadId) =>
        lookup.summary(threadId).pipe(
          Effect.map((row) => {
            if (row !== undefined) list.announce(row);
          }),
          Effect.catch((cause) => Effect.logWarning('an adopted thread could not be announced', { threadId, cause })),
        ),
    };
    const adoptionPlacement: AdoptionPlacement = {
      resolve: ({ projectId, rootId, operationId, name }) =>
        Effect.map(
          placing.resolve({
            projectId,
            worktree: rootId,
            from: null,
            operationId,
            name,
            agent: false,
            asked: false,
            guest: false,
          }),
          ({ rootId, locationRevision }) => ({ rootId, locationRevision }),
        ),
    };
    const place = yield* makeSessionPlace();
    const ended = (threadId: string) => worlds.drop(threadId);
    const statePublished = (threadId: string) => harness.threads.publish(threadId);
    const notices = {
      titled: (threadId: string) => titles.published(threadId),
      wrote: (threadId: string) => readerMarking.wrote(threadId),
    };
    const naming = (threadId: string) =>
      records
        .projectOf(threadId)
        .pipe(Effect.flatMap((projectId) => (projectId === undefined ? Effect.succeed(false) : cliTitles(settings, projectId))));
    const titleAdoption = (threadId: string): Effect.Effect<boolean> =>
      naming(threadId).pipe(
        Effect.catchTag(['EffectDrizzleQueryError', 'SqlError'], (cause) =>
          Effect.logWarning('the harness title preference could not be read; keeping the current title', { threadId, cause }).pipe(
            Effect.as(false),
          ),
        ),
      );
    const scope = yield* Effect.scope;
    const aside = (threadId: string, work: Effect.Effect<void, unknown>) =>
      Effect.asVoid(
        Effect.forkIn(
          work.pipe(
            Effect.tapCause((cause) => Effect.logWarning('a thread title was not taken', { threadId, cause: Cause.pretty(cause) })),
          ),
          scope,
        ),
      );
    const titleReported = (threadId: string, title: string) => aside(threadId, observations.titled(threadId, title));
    const titleBegun = (threadId: string, run: string) =>
      aside(
        threadId,
        Effect.flatMap(records.projectOf(threadId), (projectId) =>
          projectId === undefined
            ? Effect.void
            : Effect.flatMap(settings.value(harnessTitle, projectId), (cli) => (cli ? Effect.void : titles.begun(threadId, run))),
        ),
      );
    const adoptions = yield* Effect.acquireRelease(PubSub.sliding<void>({ capacity: 1 }), PubSub.shutdown);
    const store: HarnessSessionStore = new HarnessSessionStore(yield* makeSessionRows({ db }), (threadId, facet) => {
      return metadata
        .observed(threadId, facet)
        .pipe(
          Effect.andThen(screenAsks.observed(threadId, facet)),
          Effect.andThen(statePublished(threadId)),
          Effect.andThen(facet.execution === undefined ? Effect.void : PubSub.publish(adoptions, undefined)),
        );
    });
    const observations = new HarnessObservations(store, db, units, records, notices.titled, titleAdoption);
    const lanes = new HarnessLanes(grants, writing);
    const metadata = yield* makeSessionMetadata(
      adapters,
      store,
      observations,
      terminals,
      screens,
      executionRecords,
      discharge,
      environments,
    );
    const owner = yield* HarnessOwner;
    const ownerId = owner.id;
    const sessionEnded = (threadId: string, _session?: HarnessSession, _announce?: boolean, _runs?: readonly string[]) => ended(threadId);
    const places = yield* WorkPlaces;
    const guidance = yield* makeGuidanceSources(store, place);
    const native = yield* NativeStorage;
    const open = new OpenRuns();
    const terminalActivities = new RunActivities(inbox, yield* ActivityLog, scope);
    const terminalJournal = new TerminalJournal(
      harness.runs.reports().of('terminal'),
      native.writes,
      terminalActivities,
      harness.runs.ledger(),
    );
    yield* harness.runs
      .settlements()
      .subscribe({ name: 'terminal run activity', at: 'first', handle: (event) => terminalJournal.settled(event) });
    const turns = new VendorTurns(db, units);
    const alignment = makeSessionAlignment(
      store,
      db,
      turns,
      harness.runs.history(),
      observations,
      { terminals, writing, records: executionRecords, discharge, access: environments },
      makeSessionCarrying(accounts, files),
      ownerId,
      adapters,
    );
    const terminalClosing = new TerminalClosing(
      environments,
      Effect.map(providers.catalog, (catalog) => catalog.models),
      terminalJournal.reports,
      adapters,
    );
    const terminalWatch = new TerminalWatch(
      store,
      terminalJournal,
      open,
      inbox,
      environments,
      threads,
      terminals,
      screens,
      (threadId, run) => Effect.map(openTerminalQuestions(native.threads, threadId, run), (open) => open.length > 0),
      yield* FiberMap.make<string>(),
      terminalClosing,
      alignment,
      adapters,
    );
    const ownership = yield* harness.runs.ownership();
    const terminalEndings = new TerminalEndings(store, terminalJournal, open, terminalWatch, ownership, terminalClosing);
    const terminalWords = new TerminalWords(store, terminalJournal);
    const sessions: SessionDriver = yield* SessionDriver.make(
      store,
      records,
      terminals,
      screens,
      writing,
      executionRecords,
      requests,
      evidence,
      discharge,
      host,
      place,
      sessionEnded,
      terminalEndings,
      terminalWords,
      observations,
      lanes,
      environments,
      scratch,
      settings,
      grantSigner,
      accounts,
      providers,
      cli,
      declaring,
      alignment,
      ownerId,
    );
    const terminalHistory = makeTerminalHistory(store, turns, harness.runs.history(), sessions, adapters);
    const terminalInterrupts = new TerminalInterrupts(
      store,
      sessions,
      terminalWatch,
      terminalEndings,
      yield* FiberMap.make<string, void, never>(),
      adapters,
    );
    const terminalRuns = new TerminalRuns(
      store,
      sessions,
      terminalWords,
      terminalEndings,
      terminalInterrupts,
      open,
      terminalWatch,
      ownership,
      inbox,
      terminalJournal,
      yield* FiberMap.make<string, void, never>(),
      new ComposerDrafts(statePublished),
      adapters,
    );
    const judging = harnessJudging(threads, yield* ApprovalModes, adapters);
    const terminalAsks: TerminalAsks = new TerminalAsks(
      judging,
      (threadId) => Effect.flatMap(store.read(threadId), (facet) => (facet === null ? Effect.succeed(null) : adapters.runningRow(facet))),
      askLedger(
        store,
        terminalJournal,
        native.threads,
        (threadId) => Effect.mapError(terminalRuns.current(threadId), threadCallFailed),
        (threadId) => Effect.mapError(harness.runs.questions().reroute(threadId), threadCallFailed),
        statePublished,
      ),
      terminalFaces(store, terminals, screens, writing, lanes, adapters),
      (threadId, questionId, answers) =>
        Effect.asVoid(Effect.mapError(harness.runs.questions().answer(threadId, questionId, answers), threadCallFailed)),
    );
    const permissions = terminalPermissions(judging, terminalAsks);
    const screenAsks = yield* HarnessScreenAsks.make(store, terminals, screens, terminalAsks, (threadId) =>
      terminalRuns.released(threadId),
    );
    const held = yield* HarnessAsides;
    const journal = new ProtocolJournal(
      harness.runs.reports().of('acp', {
        display: (threadId, name, reading) => harness.runs.hosting().display(threadId, name, reading),
      }),
      native.threads,
      statePublished,
      inbox,
      yield* AttachmentFiles,
      held,
      providers,
      native.writes,
    );
    const protocol = yield* ProtocolDriver.make(
      store,
      new ProtocolRows(db, units),
      turns,
      journal,
      ownership,
      native.threads,
      native.runs,
      held,
      inbox,
      executionRecords,
      terminals,
      requests,
      writing,
      yield* ExecutionEndings,
      host,
      settings,
      grantSigner,
      accounts,
      providers,
      quota,
      lanes,
      permissions,
      yield* CompactionPlanning,
      yield* Attachments,
      place,
      sessionEnded,
      harness.runs.guidance(),
      guidance,
      harness.runs.history(),
      titleReported,
      titleBegun,
      (threadId) => core(threadId).compact({ at: 'end', mode: 'automatic' }),
      (threadId, name, reading) => harness.runs.hosting().display(threadId, name, reading),
      harness.reads.requests(),
      ownerId,
      owner.build,
      cli,
      declaring,
      (threadId) => Effect.mapError(harness.runs.questions().reroute(threadId), threadCallFailed),
    );
    yield* Effect.orDie(
      harness.runs
        .transports()
        .register(acpTransport(protocol.asks, protocol.runs, protocol.resource, protocol.history.transport, protocol.compaction)),
    );
    const core = (threadId: string) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
    const terminalGuidance = makeHookGuidance(
      harness.runs.guidance(),
      guidance,
      store,
      terminalJournal,
      places,
      records,
      harness.runs.reports(),
      harness.runs.hosting(),
      harnessIdentity(adapters),
    );
    const terminalEvents = new TerminalEvents(
      lookups,
      store,
      observations,
      terminalJournal,
      threads,
      open,
      permissions,
      titleBegun,
      terminalWatch,
      terminalGuidance,
      terminalClosing,
      (threadId) => sessions.lease.heard(threadId),
      (threadId, turn) => terminalInterrupts.restarted(threadId, turn),
      yield* makeTerminalCommands,
      alignment,
      adapters,
    );
    yield* Effect.orDie(
      harness.runs.transports().register(
        terminalTransport(
          terminalRuns.transport,
          {
            release: (threadId) => failedAs('terminal.release', sessions.stop(threadId)),
            seated: (threadId) => failedAs('terminal.seated', Effect.asVoid(sessions.launch(threadId, null, ''))),
            watch: () =>
              failedAs(
                'terminal.watch',
                Effect.flatMap(sessions.lease.recover(), (standing) =>
                  Effect.andThen(terminalWatch.rearm(standing), terminalInterrupts.rearm(standing)),
                ),
              ),
          },
          terminalAsks.asks,
          terminalHistory.transport,
        ),
      ),
    );
    const words = yield* makeProtocolWords({ driver: protocol });
    const registry = harness.runs.transports();
    const reports = HarnessReports.of({
      reported: (threadId, reported) => terminalEvents.reported(threadId, reported),
    });
    const births = yield* makeSessionBirths;
    const adoption = yield* makeAdoption({ list: adoptionList, births, sessions, placement: adoptionPlacement });
    return Context.make(HarnessSessions, words).pipe(
      Context.add(SessionMetadata, metadata),
      Context.add(HarnessAdoption, adoption),
      Context.add(TerminalAdopters, TerminalAdopters.of({ of: adoption.adopters, moves: Stream.fromPubSub(adoptions) })),
      Context.add(HarnessReports, reports),
      Context.add(HarnessPermissions, permissions),
      Context.add(HarnessGuidance, terminalGuidance),
      Context.add(NotesReach, notesReach(lookups, store, adapters)),
      Context.add(HarnessSpeech, harnessSpeech(records, threads, words, notices.wrote)),
      Context.add(ScreenAsks, screenTexts(records, threads, terminals, screens)),
      Context.add(ProtocolStates, protocolStates(records, threads, protocol.state)),
      Context.add(
        HostedOpenings,
        HostedOpenings.of({ owe: (threadId, told, unit) => turns.owe(unit, threadId, told), owed: (threadId) => turns.owed(threadId) }),
      ),
      Context.add(TransportSwitch, transportSwitch(records, lookup, store, yield* ThreadRebinding, registry, providers, adapters)),
      Context.add(HarnessImplementations, (row, retract) =>
        externalHarness(
          row,
          births,
          protocol,
          terminalHistory,
          (harnessName, spawnRootId, principal) =>
            harnessSpend(db, units, harnessName, spawnRootId, principal).pipe(
              Effect.mapError((cause) => new ThreadStorageFailed({ call: 'harnessSpend', cause })),
            ),
          store,
          retract,
          metadata,
          providers,
        ),
      ),
    );
  }),
);
