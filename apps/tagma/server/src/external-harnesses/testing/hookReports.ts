import { Clock, Context, Effect, FiberMap, Layer } from 'effect';
import { activityRecording } from '@runlith/activity/testing';
import { openMemoryStorage } from '@runlith/agent/thread/conformance/memoryStorage';
import { lifecycleWorldOver, OWNER, SCOPE } from '@runlith/agent/thread/conformance/lifecycleWorld';
import { fakeAdapter } from '@runlith/agent/thread/conformance/fakeTransport';
import type { GuidanceSources } from '@runlith/agent/thread/transport/contract';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { terminalKernel } from '../birth/seat.js';
import { HarnessReports } from '../contract/service/reports.js';
import { HarnessPermissions } from '../contract/service/permissions.js';
import type { SessionThreads } from '../contract/service/sessionThreads.js';
import { HarnessSessionStore, type SessionPublished } from '../store/sessions.js';
import { HarnessObservations } from '../observations/admission.js';
import { TerminalEvents } from '../terminal/events.js';
import { TerminalJournal } from '../terminal/journal.js';
import { TerminalClosing } from '../terminal/closing.js';
import { TerminalWatch } from '../terminal/watch.js';
import { OpenRuns } from '../terminal/open.js';
import { RunActivities } from '../protocol/activities.js';
import { makeHookGuidance } from '../guidance.js';
import { notesReach } from '../notesReach.js';
import { memorySessionRows } from './memorySessions.js';
import type { RunHosting } from '../contract/service/guidance.js';
import { standingAlignment } from './alignment.js';
import { harnessArgv, harnessPresentation } from '../contract/service/table.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { ExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { ThreadInbox } from '../../threads/store/inbox.js';
import { SessionLookupStore } from '../../threads/store/sessionLookups.js';
import { SessionObservations } from '../contract/service/observations.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { WorkPlaces } from '../../threads/contract/service/working.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { Terminals } from '../../executions/contract/service/terminals.js';
import { TerminalScreens } from '../../executions/contract/service/records.js';

const unused = () => Effect.die('This hook report does not read that boundary.');
const uncalled = (): never => {
  throw new Error('This hook report subscribes to no record or permission prompt.');
};
const silent: GuidanceSources = { orientation: unused, law: unused, recap: unused, tail: () => Effect.succeed(null) };

export const unhosted: RunHosting = {
  agent: unused,
  history: unused,
  open: unused,
  tools: unused,
  display: () => undefined,
  call: unused,
  holds: unused,
  answer: unused,
};

export type HookReportOptions = {
  readonly name?: HarnessName;
  readonly key?: string | null;
  readonly sources?: GuidanceSources;
  readonly access?: Environments['Service'];
  readonly terminals?: Layer.PartialEffectful<Terminals['Service']>;
  readonly screens?: Layer.PartialEffectful<TerminalScreens['Service']>;
  readonly published?: SessionPublished;
};

export const hookReports = Effect.fnUntraced(function* ({
  name = 'codex',
  key = null,
  sources = silent,
  access: suppliedAccess,
  terminals = {},
  screens = {},
  published = () => Effect.void,
}: HookReportOptions = {}) {
  const storage = yield* openMemoryStorage();
  const kernel = terminalKernel(name, undefined, false, {});
  const first = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE, transport: kernel.transport });
  yield* storage.aggregate.update(first.id, { capabilities: kernel.capabilities });
  const world = yield* lifecycleWorldOver(storage, (yield* storage.aggregate.find(first.id))!, undefined, fakeAdapter('terminal'));
  const memory = yield* memorySessionRows(storage);
  const store = new HarnessSessionStore(memory.rows, published);
  const ports = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(SessionObservations, {
        admit: HarnessObservations.prototype.admit,
        releaseHeld: () => Effect.succeed({ publish: [], session: null }),
        expireHeld: () => Effect.succeed({ deliver: [], session: null }),
      }),
      Layer.mock(ThreadRecords, {
        writes: memory.rows.writes,
        projectOf: () => Effect.succeed(7),
        birthRecorded: uncalled,
        removalRecorded: uncalled,
        titleRecorded: uncalled,
        statusPublished: uncalled,
        shelfRecorded: uncalled,
      }),
      Layer.mock(WorkPlaces, {}),
      suppliedAccess === undefined ? Layer.mock(Environments, {}) : Layer.succeed(Environments, suppliedAccess),
      Layer.mock(Terminals, terminals),
      Layer.mock(TerminalScreens, screens),
      Layer.mock(HarnessPermissions, { ended: () => Effect.void, prompt: uncalled }),
      Layer.mock(ThreadInbox, {
        writes: memory.rows.writes,
        pending: (id) => storage.inbox.pending(id).pipe(Effect.orDie),
        receipt: (id) => storage.inbox.receipt(id).pipe(Effect.orDie),
        delivered: (id, run) => storage.inbox.delivered(id, run).pipe(Effect.orDie),
      }),
      Layer.mock(SessionLookupStore, {
        harnessOf: (id) =>
          Effect.flatMap(storage.aggregate.find(id), (row) => (row === undefined ? Effect.succeed(undefined) : store.read(id))).pipe(
            Effect.orDie,
          ),
      }),
    ),
  );
  const records = Context.get(ports, ThreadRecords);
  const inbox = Context.get(ports, ThreadInbox);
  const observed = Context.get(ports, SessionObservations);
  const threads: SessionThreads = {
    find: Effect.fnUntraced(function* (id: string) {
      const row = yield* storage.aggregate.find(id);
      return row === undefined ? undefined : { harness: yield* store.read(id), authority: row.authority };
    }, Effect.orDie),
    runningRun: (id, unit) => Effect.map(world.ledger.activeRunIn(id, unit), (run) => run?.id ?? null).pipe(Effect.orDie),
  };
  const activities = activityRecording();
  const journal = new TerminalJournal(
    world.reports.of('terminal'),
    memory.rows.writes,
    new RunActivities(inbox, activities.log, yield* Effect.scope),
    world.ledger,
  );
  yield* world.settlements.subscribe({ name: 'hook report activity', at: 'first', handle: (event) => journal.settled(event) });
  const open = new OpenRuns();
  const access = Context.get(ports, Environments);
  const closing = new TerminalClosing(access, Effect.succeed(modelCatalog([])), journal.reports);
  const watch = new TerminalWatch(
    store,
    journal,
    open,
    inbox,
    access,
    threads,
    Context.get(ports, Terminals),
    Context.get(ports, TerminalScreens),
    () => Effect.succeed(false),
    yield* FiberMap.make<string>(),
    closing,
    standingAlignment(store),
  );
  const guidance = makeHookGuidance(
    world.guidance,
    sources,
    store,
    journal,
    Context.get(ports, WorkPlaces),
    records,
    world.reports,
    unhosted,
  );
  const events = new TerminalEvents(
    Context.get(ports, SessionLookupStore),
    store,
    observed,
    journal,
    threads,
    open,
    Context.get(ports, HarnessPermissions),
    () => Effect.void,
    watch,
    guidance,
    closing,
    () => Effect.void,
    unused,
    { opened: () => Effect.void, settled: () => Effect.void, ended: () => Effect.void },
    standingAlignment(store),
  );
  const reports = HarnessReports.of({ reported: (threadId, input) => events.reported(threadId, input) });
  const seed = Effect.fnUntraced(function* (id: string, harness: HarnessName, root: string | null) {
    const session = crypto.randomUUID();
    const facet: ExternalSession = {
      ...harnessFacet(harness, harnessPresentation(harness)),
      sessionKey: root,
      session: {
        id: session,
        origin: 'launched',
        state: 'running',
        prompt: '',
        cwd: '/project',
        argv: yield* harnessArgv(harness, root, session, ''),
        startedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      },
    };
    yield* memory.seed(id, facet);
    return { id, session };
  });
  const initial = yield* seed(first.id, name, key);
  const create = Effect.fnUntraced(function* (harness: HarnessName, root: string | null = null) {
    const seat = terminalKernel(harness, undefined, false, {});
    const row = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE, transport: seat.transport });
    yield* storage.aggregate.update(row.id, { capabilities: seat.capabilities });
    return yield* seed(row.id, harness, root);
  });
  return {
    ...initial,
    storage,
    world,
    store,
    rows: memory.rows,
    reports,
    guidance,
    notes: notesReach(Context.get(ports, SessionLookupStore), store),
    activities,
    ports,
    journal,
    closing,
    watch,
    open,
    create,
  };
});
