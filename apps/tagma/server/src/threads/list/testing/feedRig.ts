import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { Effect } from 'effect';
import { makeThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadRunRow } from '@runlith/agent/thread/rows';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '@runlith/agent/thread/record';
import { applyThreadEntryPlacement, heldInList, placeThreadEntry, type ThreadEventDelta } from '@runlith/agent/transcript/eventFold';
import type { FeedPosition, ThreadPendingInput } from '@runlith/agent/transcript/live';
import type { ThreadTranscript, ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { NativeThreadState } from '../../contract/service/state.js';
import { threadFeeds, type FeedServices } from '../feeds.js';

const MODELS = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS);

const at = new Date('2026-10-03T00:00:00.000Z');

export const feedRun: ThreadRunRow = {
  id: 'run',
  threadId: 'thread',
  kind: 'turn',
  origin: 'core',
  ownerId: 'operator',
  status: 'running',
  account: null,
  provider: 'openai-oauth',
  model: null,
  reasoning: null,
  switches: {},
  approvalMode: 'trust',
  interactive: true,
  progress: { stage: 'streaming', message: null },
  usage: null,
  cost: null,
  streamTail: null,
  resumes: 0,
  failureReason: null,
  failure: null,
  createdAt: at,
  startedAt: at,
  heartbeatAt: at,
  handedOverAt: null,
  finishedAt: null,
  settledNotifiedAt: null,
  settledBy: null,
  settledNotification: null,
  settledNotifyAttempts: 0,
  stopRequest: null,
  withdrawnWords: null,
  updatedAt: at,
};

const initial: NativeThreadState = {
  thread: {
    id: 'thread',
    ownerId: 'operator',
    agentId: 'agent',
    parentThreadId: null,
    spawnedByRunId: null,
    bornOf: null,
    spawnRootId: 'thread',
    cacheGroup: 'thread',
    name: null,
    budgetTokens: null,
    profile: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    hostKind: null,
    hostId: null,
    bindings: {},
    pendingInteraction: null,
    account: null,
    provider: 'openai-oauth',
    model: null,
    reasoning: null,
    switches: {},
    transport: NATIVE_BINDING,
    capabilities: NATIVE_CAPABILITIES,
    status: 'running',
    failureReason: null,
    contextReading: null,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
  },
  activeRun: feedRun,
  latestRun: feedRun,
  position: 0,
  pendingInput: { queued: [], steers: [] },
  status: {
    threadId: 'thread',
    runId: feedRun.id,
    life: 'working',
    stage: null,
    openQuestions: [],
    since: at.toISOString(),
    ownership: 'held',
    receipts: [],
  },
  now: at.toISOString(),
  title: 'thread',
  harness: null,
  delegation: { own: null, allowed: true, setAt: null },
  approving: { approver: null, why: 'no-parent', takenOver: false, approves: { own: null, effective: [], origin: 'setting', setAt: null } },
  spawnDepth: { current: 0, maximum: 0, remaining: 0 },
  place: null,
  recap: null,
  recapAttempt: null,
  modes: [],
  pins: [],
};

function unused(): never {
  throw new Error('This operation is outside the subscription.');
}

type Fact = Omit<ThreadEventDelta, 'position'>;

export const feedRig = Effect.fnUntraced(function* () {
  const live = yield* makeThreadLiveFeed<NativeThreadState>();
  const records: ThreadEventDelta[] = [];
  let pendingInput: ThreadPendingInput = initial.pendingInput;
  let running = true;
  let duringRead: (() => void) | undefined;
  let limit: ThreadContextLimit | null = null;
  const state = (): NativeThreadState => ({
    ...initial,
    activeRun: running ? initial.activeRun : null,
    position: records.length,
    pendingInput,
  });
  const folded = (upto: number) =>
    records
      .filter((record) => record.position <= upto)
      .reduce<ThreadTranscript>((transcript, record) => {
        const placement = placeThreadEntry(heldInList(transcript), record);
        return placement === null ? transcript : applyThreadEntryPlacement(transcript, placement);
      }, []);
  const view = () => {
    const held = live.view('thread');
    return { ...held, at: { position: records.length, seq: held.at.seq } };
  };
  const services: FeedServices = {
    list: {
      attention: unused,
      pulse: unused,
      subscribeAttention: unused,
      observe: unused,
      list: unused,
      listWindow: unused,
      openWindow: unused,
      row: unused,
      subscribe: unused,
      announce: unused,
      announceThread: unused,
      announceFolders: unused,
      resync: unused,
      markHeld: unused,
      relation: unused,
      working: unused,
      sweepRelation: unused,
      serveArchiving: unused,
      serveOpenCalls: unused,
      setArchived: unused,
      setArchivedMatching: unused,
      setPinned: unused,
      see: unused,
    },
    folders: { list: unused, create: unused, rename: unused, move: unused, remove: unused, file: unused },
    evidence: {
      statuses: unused,
      presence: unused,
      presenceOne: unused,
      endings: unused,
      snapshot: () =>
        Effect.sync(() => {
          const pending = duringRead;
          duringRead = undefined;
          pending?.();
          return { ...state(), transcript: folded(records.length), before: null, live: view() };
        }),
      shape: unused,
      composition: unused,
      held: unused,
      entry: unused,
      entries: unused,
      attachFrom: (_threadId, _projectId, since) =>
        Effect.sync(() => ({ state: state(), deltas: records.filter((record) => record.position > since), live: view() })),
      rewindActs: unused,
    },
    feed: {
      subscribe: (threadId, listener) => live.subscribe(threadId, listener),
      view: (threadId) => live.view(threadId),
    },
    basis: {
      warmth: {
        cacheCurves: () => Effect.succeed(new Map()),
        warmthBasis: () => Effect.succeed({ curves: new Map(), accounts: new Map(), models: MODELS }),
      },
      limits: { of: () => Effect.sync(() => new Map(limit === null ? [] : [['thread', limit]])) },
    },
  };
  const feeds = threadFeeds(services);
  const publish = (fact: Fact, pending?: ThreadPendingInput) => {
    if (pending !== undefined) pendingInput = pending;
    const record = { ...fact, position: records.length + 1 };
    records.push(record);
    live.publishState({ state: state(), from: record.position - 1, deltas: [record] });
  };
  return {
    live,
    stream: feeds['thread.subscribe']({ projectId: 1, threadId: 'thread' }),
    reconnect: (since: FeedPosition) => feeds['thread.subscribe']({ projectId: 1, threadId: 'thread', since }),
    publish,
    land(entry: ThreadTranscriptEntry, pending?: ThreadPendingInput) {
      publish({ kind: entry.type, entry }, pending);
    },
    pending(next: ThreadPendingInput) {
      pendingInput = next;
      live.publishState({ state: state(), from: records.length, deltas: [] });
    },
    limit(next: ThreadContextLimit | null) {
      limit = next;
    },
    republish() {
      live.publishState({ state: state(), from: records.length, deltas: [] });
    },
    end(entry: ThreadTranscriptEntry) {
      running = false;
      publish({ kind: entry.type, entry });
    },
    open: () => live.view('thread').open,
    transcript: () => folded(records.length),
    duringRead(work: () => void) {
      duringRead = work;
    },
  };
});
