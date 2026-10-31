import { Clock, Effect } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
import type { ThreadTx, ThreadWriteTx } from '../ThreadPorts';
import { applyThreadEntryPlacements } from '../../transcript/eventFold';
import type { ThreadContextReading, ThreadHistory, ThreadRow } from '../rows';
import type { ThreadAggregateStorage, ThreadAtomicPatch } from './aggregate';
import { evidenceKey, type Evidence } from '../keyed';
import type {
  RecordReading,
  RecordWrite,
  ThreadAt,
  ThreadFoldWrite,
  ThreadHold,
  ThreadTransitionStorage,
  ThreadVersion,
} from '../transition/port';
import type { ThreadCacheObservation } from './cacheObservations';
import { MemoryTx } from './memory/units';
import { openQuestionsIn } from '../../transcript/questions';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadTranscript } from '../../transcript/rows';
import { NATIVE_BINDING, NATIVE_CAPABILITIES } from '../record';
import type { ThreadChangeRevision } from '../state';

export type AggregateMemoryInput = {
  readonly transcript?: ThreadTranscript;
  readonly trace?: string[];
  readonly sliceReads?: 'answer' | 'refuse';
};

type AggregateMemoryState = {
  history: ThreadHistory;
  transcript: ThreadTranscript;
  contextReading: ThreadContextReading | null;
  systemPrompt: string | null;
  pendingSystemPrompt: string | null;
  readonly cacheObservations: ThreadCacheObservation[];
  updates: number;
  updateFailure: unknown;
  head: number;
  readonly trace: string[];
};

export type InMemoryAggregateStorage = AggregateMemoryState &
  ThreadAggregateStorage<ThreadTx, ThreadWriteTx> &
  ThreadTransitionStorage<ThreadTx, ThreadWriteTx> & {
    row(id: string): ThreadRow;
  };

export const makeAggregateStorage = ({
  transcript = [],
  trace = [],
  sliceReads = 'answer',
}: AggregateMemoryInput = {}): InMemoryAggregateStorage => {
  const state: AggregateMemoryState = {
    history: [],
    transcript,
    contextReading: null,
    systemPrompt: null,
    pendingSystemPrompt: null,
    cacheObservations: [],
    updates: 0,
    updateFailure: null,
    head: 0,
    trace,
  };
  let foldRev = 0;
  let commits = 0;
  let records = new Map<string, RecordWrite>();
  const applied = new Map<string, number>();
  let staged: ThreadFoldWrite[] | null = null;
  const version = (): ThreadVersion => ({ foldRev, head: state.head, inheritRev: 0 });
  const snapshot = () => ({
    history: state.history,
    transcript: state.transcript,
    contextReading: state.contextReading,
    systemPrompt: state.systemPrompt,
    pendingSystemPrompt: state.pendingSystemPrompt,
    observations: state.cacheObservations.length,
    foldRev,
    head: state.head,
    records: new Map(records),
  });
  const restore = (saved: ReturnType<typeof snapshot>): void => {
    state.history = saved.history;
    state.transcript = saved.transcript;
    state.contextReading = saved.contextReading;
    state.systemPrompt = saved.systemPrompt;
    state.pendingSystemPrompt = saved.pendingSystemPrompt;
    state.cacheObservations.length = saved.observations;
    foldRev = saved.foldRev;
    state.head = saved.head;
    records = saved.records;
  };
  const row = (id: string): ThreadRow => {
    const timestamp = new Date('2026-06-19T12:00:00.000Z');
    return {
      id,
      ownerId: 'owner-1',
      agentId: 'agent-1',
      parentThreadId: null,
      spawnedByRunId: null,
      bornOf: null,
      spawnRootId: id,
      cacheGroup: id,
      name: null,
      authority: { mode: 'trust', bypassFrom: null },
      plain: false,
      profile: null,
      budgetTokens: null,
      hostKind: null,
      hostId: null,
      bindings: {},
      pendingInteraction: null,
      account: null,
      provider: 'test-provider',
      model: null,
      reasoning: null,
      switches: {},
      transport: NATIVE_BINDING,
      capabilities: NATIVE_CAPABILITIES,
      systemPrompt: state.systemPrompt,
      pendingSystemPrompt: state.pendingSystemPrompt,
      status: 'running',
      failureReason: null,
      contextReading: state.contextReading,
      createdBy: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      history: state.history,
    };
  };
  const applyFold = (id: string, patch: ThreadAtomicPatch): void => {
    if (patch.history) state.history = patch.history;
    if (patch.placements) state.transcript = applyThreadEntryPlacements(state.transcript, patch.placements);
    if (patch.contextReading !== undefined) state.contextReading = patch.contextReading;
    if (patch.systemPrompt !== undefined) state.systemPrompt = patch.systemPrompt;
    if (patch.pendingSystemPrompt !== undefined) state.pendingSystemPrompt = patch.pendingSystemPrompt;
    for (const values of patch.cacheObservations ?? []) state.cacheObservations.push({ ...values, threadId: id });
    foldRev += 1;
  };
  const landFold = (id: string, write: ThreadFoldWrite): void => {
    applyFold(id, write.fold);
    state.head = write.head;
  };
  const readAt = <T, E>(
    id: string,
    work: (at: ThreadAt<ThreadTx>) => Effect.Effect<T, E>,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure> => Effect.suspend(() => work({ row: row(id), version: version(), tx: undefined }));
  const writeAt = <T, E>(
    id: string,
    work: (at: ThreadHold<ThreadWriteTx>) => Effect.Effect<T, E>,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure> => inUnit(id, (tx) => work({ row: row(id), version: version(), tx }));
  const inUnit = <T, E>(id: string, work: (tx: ThreadWriteTx) => Effect.Effect<T, E>): Effect.Effect<T, E | ThreadPortFailure> =>
    Effect.flatMap(Clock.Clock, (clock) => {
      state.updates += 1;
      if (state.updateFailure) return Effect.die(state.updateFailure);
      trace.push('unit-open');
      const saved = snapshot();
      const writes: ThreadFoldWrite[] = [];
      staged = writes;
      const unit = new MemoryTx({ clock });
      return work(unit as unknown as ThreadWriteTx).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            staged = null;
            for (const write of writes) landFold(id, write);
            commits += 1;
            trace.push('unit-close');
          }),
        ),
        Effect.onError(() =>
          Effect.sync(() => {
            staged = null;
            unit.rollback();
            restore(saved);
          }),
        ),
        Effect.tap(() => Effect.forEach(unit.end(), (tail) => tail, { discard: true })),
      );
    });
  const writeFold = (id: string, write: ThreadFoldWrite): Effect.Effect<void, ThreadPortFailure> =>
    Effect.sync(() => {
      if (staged) staged.push(write);
      else landFold(id, write);
    });
  const readRecord = (_id: string, evidence: Evidence): Effect.Effect<RecordReading, ThreadPortFailure> =>
    Effect.sync(() => {
      if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return { kind: 'decided' };
      const standing = records.get(recordKey(evidence));
      return standing ? { kind: 'present', digest: standing.digest, result: standing.result } : { kind: 'absent' };
    });
  const writeRecord = (_id: string, evidence: Evidence, write: RecordWrite): Effect.Effect<void, ThreadPortFailure> =>
    Effect.sync(() => {
      if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return;
      if ('seq' in evidence) applied.set(evidence.run, evidence.seq);
      records.set(recordKey(evidence), write);
    });
  const offPath = (call: string): Effect.Effect<never, ThreadPortFailure> =>
    Effect.die(new Error(`The suite's runs never reach ${call} on the aggregate port.`));
  return Object.assign(state, {
    row,
    readAt,
    writeAt,
    writeAtIn: writeAt,
    writeFold,
    readRecord,
    writeRecord,
    spend: () => Effect.void,
    appliedSeq: (runId: string) => Effect.sync(() => applied.get(runId) ?? 0),
    revision: () => Effect.sync(() => commits),
    opened: () => Effect.void,
    revised: (_id: string, tx: ThreadWriteTx, after: (revision: ThreadChangeRevision) => Effect.Effect<void>) =>
      Effect.suspend(() => {
        const from = commits;
        return tx.afterCommit(after({ from, to: from + 1 }));
      }),
    transaction: <T, E>(body: (tx: ThreadWriteTx) => Effect.Effect<T, E>) => inUnit('', body),
    find: () => offPath('find'),
    findOwned: () => offPath('findOwned'),
    metadataOf: () => offPath('metadataOf'),
    metadata: () => offPath('metadata'),
    logs: () => offPath('logs'),
    transcriptOf: () => offPath('transcriptOf'),
    historyOf: () => offPath('historyOf'),
    transcriptWindow: () => offPath('transcriptWindow'),
    insert: () => offPath('insert'),
    insertChild: () => offPath('insertChild'),
    findNamed: () => offPath('findNamed'),
    pageTeam: () => offPath('pageTeam'),
    update: () => offPath('update'),
    appendEntries: () => offPath('appendEntries'),
    branch: () => offPath('branch'),
    delete: () => offPath('delete'),
    listByHost: () => offPath('listByHost'),
    listByParent: () => offPath('listByParent'),
    listSubtree: () => offPath('listSubtree'),
    holdSubtree: () => offPath('holdSubtree'),
    systemPromptOf: () => Effect.succeed({ systemPrompt: state.systemPrompt, pendingSystemPrompt: state.pendingSystemPrompt }),
    entriesOfRun: (_id: string, runId: string) =>
      sliceReads === 'refuse' ? offPath('entriesOfRun') : Effect.succeed(state.transcript.filter((entry) => entry.runId === runId)),
    openQuestionsOfRun: (_id: string, runId: string) =>
      sliceReads === 'refuse'
        ? offPath('openQuestionsOfRun')
        : Effect.succeed(openQuestionsIn(state.transcript.filter((entry) => entry.runId === runId))),
    questionById: (_id: string, questionId: string) =>
      sliceReads === 'refuse'
        ? offPath('questionById')
        : Effect.succeed(
            state.transcript.findLast(
              (entry): entry is ThreadQuestionEntry & typeof entry =>
                coreEntry(entry) && entry.type === 'question' && entry.questionId === questionId,
            ),
          ),
    entryById: (_id: string, entryId: string) =>
      sliceReads === 'refuse' ? offPath('entryById') : Effect.succeed(state.transcript.find((entry) => entry.id === entryId)),
  });
};

function recordKey(evidence: Evidence): string {
  return 'runEnd' in evidence ? `${evidenceKey(evidence)}:${evidence.status}` : evidenceKey(evidence);
}
