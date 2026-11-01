import { Effect, Semaphore } from 'effect';
import type { ThreadPortFailure } from '../ThreadBorder';
import { attempt } from './memory/attempt';
import { applyThreadEntryPlacements } from '../../transcript/eventFold';
import { openQuestionsIn } from '../../transcript/questions';
import type { ThreadQuestionEntry } from '../../transcript/entries';
import { coreEntry } from '../../transcript/kinds';
import type { ThreadTranscript } from '../../transcript/rows';
import { evidenceKey, mintedBefore, type Evidence } from '../keyed';
import type { ThreadRow } from '../rows';
import {
  SequenceUnavailable,
  type RecordWrite,
  type ThreadHold,
  type ThreadTransitionStorage,
  type ThreadVersion,
} from '../transition/port';
import type { ThreadAggregateStorage } from './aggregate';
import type { ThreadCacheObservationValues } from './cacheObservations';
import type { ThreadEventLogStorage, ThreadEventRow } from './eventLog';

type Held = {
  row: ThreadRow;
  transcript: ThreadTranscript;
  events: ThreadEventRow[];
  observations: ThreadCacheObservationValues[];
  foldRev: number;
  inheritRev: number;
  appliedSeq: Map<string, number>;
};

type World = {
  threads: Map<string, Held>;
  records: Map<string, RecordWrite & { status?: string; threadId?: string }>;
  spent: Map<string, { digest: string; at: Date }>;
};

type RacingState = {
  epoch: Date | null;
  units: number;
  beforeUnit: Effect.Effect<void, ThreadPortFailure>;
};

type Tombstone = { readonly evidence: Evidence; readonly at: Date };

export type RacingThreadTransitions = RacingState &
  ThreadTransitionStorage<undefined> & {
    readonly store: ThreadAggregateStorage<undefined>;
    readonly log: ThreadEventLogStorage<undefined>;
    seed(row: ThreadRow, transcript?: ThreadTranscript): void;
    held(threadId: string): Readonly<Held>;
    touchFold(threadId: string): void;
    touchInherit(threadId: string): void;
    forget(threadId: string, tombstones: readonly Tombstone[]): void;
  };

export const makeRacingThreadTransitions = Effect.gen(function* () {
  let world: World = { threads: new Map(), records: new Map(), spent: new Map() };
  const queue = yield* Semaphore.make(1);
  const state: RacingState = { epoch: null, units: 0, beforeUnit: Effect.void };
  const mutable = (threadId: string): Held => {
    const held = world.threads.get(threadId);
    if (!held) throw new Error(`The in-memory transitions hold no thread ${threadId}.`);
    return held;
  };
  const unit = <T, E>(
    threadId: string,
    work: (at: ThreadHold<undefined>) => Effect.Effect<T, E>,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure> =>
    Effect.suspend(() => {
      state.units += 1;
      return state.beforeUnit.pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const saved = cloneWorld(world);
            const held = world.threads.get(threadId);
            if (!held) return Effect.succeed(undefined);
            return work({ row: held.row, version: versionOf(held), tx: undefined }).pipe(
              Effect.onError(() =>
                Effect.sync(() => {
                  world = saved;
                }),
              ),
            );
          }),
        ),
      );
    });
  const writeAt: ThreadTransitionStorage<undefined>['writeAt'] = (threadId, work) => queue.withPermits(1)(unit(threadId, work));
  const transitions: ThreadTransitionStorage<undefined> = {
    readAt: (threadId, work) =>
      Effect.suspend(() => {
        const held = world.threads.get(threadId);
        return held ? work({ row: held.row, version: versionOf(held), tx: undefined }) : Effect.succeed(undefined);
      }),
    writeAt,
    writeAtIn: writeAt,
    writeFold: (threadId, write) =>
      attempt('writeFold', () => {
        const held = mutable(threadId);
        const { history, covered: _covered, placements, contextReading, cacheObservations, ...columns } = write.fold;
        held.row = {
          ...held.row,
          ...columns,
          history: history ?? held.row.history,
          contextReading: contextReading === undefined ? held.row.contextReading : contextReading,
        };
        if (placements !== undefined) held.transcript = applyThreadEntryPlacements(held.transcript, placements);
        if (cacheObservations !== undefined) held.observations.push(...cacheObservations);
        held.foldRev += 1;
      }),
    readRecord: (threadId, evidence) =>
      attempt('readRecord', () => {
        if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence) return { kind: 'decided' };
        if ('seq' in evidence) {
          const applied = mutable(threadId).appliedSeq.get(evidence.run) ?? 0;
          const ended = world.records.has(evidenceKey({ runEnd: evidence.run, status: 'completed' }));
          if (ended) throw new SequenceUnavailable(evidence.run, evidence.seq, 'ended');
          if (evidence.seq < applied) throw new SequenceUnavailable(evidence.run, evidence.seq, 'advanced');
          if (evidence.seq > applied + 1)
            throw new Error(`Run ${evidence.run} stands at sequence ${applied}, so sequence ${evidence.seq} would leave a gap.`);
        }
        const key = evidenceKey(evidence);
        const standing = world.records.get(key);
        if (standing && 'runEnd' in evidence && standing.status !== evidence.status) return { kind: 'decided' };
        if (standing && 'envelope' in evidence) return { kind: 'standing', digest: standing.digest };
        if (standing) return { kind: 'present', digest: standing.digest, result: standing.result };
        if ('seq' in evidence && evidence.seq <= (mutable(threadId).appliedSeq.get(evidence.run) ?? 0))
          throw new Error(`Run ${evidence.run} applied past sequence ${evidence.seq} but holds no record of it.`);
        const spent = world.spent.get(key);
        if (spent) return { kind: 'spent', digest: spent.digest, at: spent.at };
        if (('call' in evidence || 'envelope' in evidence || 'started' in evidence) && mintedBefore(callId(evidence), state.epoch))
          return { kind: 'before-epoch' };
        return { kind: 'absent' };
      }),
    writeRecord: (threadId, evidence, write) =>
      attempt('writeRecord', () => {
        if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence) return;
        if ('seq' in evidence) {
          const held = mutable(threadId);
          const applied = held.appliedSeq.get(evidence.run);
          if (applied !== undefined) world.records.delete(evidenceKey({ run: evidence.run, seq: applied }));
          held.appliedSeq.set(evidence.run, evidence.seq);
        }
        if ('runEnd' in evidence) {
          const applied = mutable(threadId).appliedSeq.get(evidence.runEnd);
          if (applied !== undefined) world.records.delete(evidenceKey({ run: evidence.runEnd, seq: applied }));
        }
        if ('started' in evidence)
          throw new Error(`Start ${evidence.started.id} is keyed on the run row its creation wrote, never recorded after it.`);
        world.records.set(
          evidenceKey(evidence),
          'runEnd' in evidence ? { ...write, status: evidence.status, threadId } : { ...write, threadId },
        );
      }),
    spend: (threadIds, at) =>
      attempt('spend', () => {
        const ending = new Set(threadIds);
        for (const [key, standing] of world.records) {
          if (
            standing.threadId === undefined ||
            !ending.has(standing.threadId) ||
            !(key.startsWith('call:') || key.startsWith('envelope:') || key.startsWith('started:'))
          )
            continue;
          world.spent.set(key, { digest: standing.digest, at });
          world.records.delete(key);
        }
      }),
    appliedSeq: (runId) =>
      attempt('appliedSeq', () => {
        for (const held of world.threads.values()) {
          const applied = held.appliedSeq.get(runId);
          if (applied !== undefined) return applied;
        }
        return 0;
      }),
    revision: offPath,
    opened: offPath,
    revised: offPath,
  };
  const store: ThreadAggregateStorage<undefined> = {
    readCut: offPath,
    openToolsOfRun: offPath,
    transaction: offPath,
    find: offPath,
    findOwned: offPath,
    metadata: offPath,
    metadataOf: offPath,
    systemPromptOf: offPath,
    logs: offPath,
    transcriptOf: offPath,
    historyOf: offPath,
    transcriptWindow: offPath,
    insert: offPath,
    insertChild: offPath,
    appendEntries: offPath,
    branch: offPath,
    delete: offPath,
    pageTeam: offPath,
    findNamed: offPath,
    listByHost: offPath,
    listByParent: offPath,
    listSubtree: offPath,
    holdSubtree: offPath,
    entriesOfRun: (threadId, runId) => attempt('entriesOfRun', () => mutable(threadId).transcript.filter((entry) => entry.runId === runId)),
    openQuestionsOfRun: (threadId, runId) =>
      attempt('openQuestionsOfRun', () => openQuestionsIn(mutable(threadId).transcript.filter((entry) => entry.runId === runId))),
    questionById: (threadId, questionId) =>
      attempt('questionById', () =>
        mutable(threadId).transcript.findLast(
          (entry): entry is ThreadQuestionEntry & typeof entry =>
            coreEntry(entry) && entry.type === 'question' && entry.questionId === questionId,
        ),
      ),
    entryById: (threadId, entryId) => attempt('entryById', () => mutable(threadId).transcript.find((entry) => entry.id === entryId)),
    update: (threadId, patch) =>
      attempt('update', () => {
        const held = mutable(threadId);
        held.row = { ...held.row, ...patch };
        held.foldRev += 1;
      }),
  };
  const log: ThreadEventLogStorage<undefined> = {
    recordsAsOf: offPath,
    revisionsAsOf: offPath,
    eventsAfter: offPath,
    headPosition: offPath,
    positionOf: offPath,
    append: (event) =>
      attempt('append', () => {
        const held = mutable(event.threadId);
        const standing = held.events.find((row) => row.id === event.id);
        if (standing) {
          if (standing.kind !== event.kind || JSON.stringify(standing.payload) !== JSON.stringify(event.payload))
            throw new Error(`Thread event ${event.id} is already taken by another fact.`);
          return standing;
        }
        const row = { ...event, position: held.events.length + 1 };
        held.events.push(row);
        held.foldRev += 1;
        return row;
      }),
  };
  const memory: RacingThreadTransitions = Object.assign(state, transitions, {
    store,
    log,
    seed: (row: ThreadRow, transcript: ThreadTranscript = []): void => {
      world.threads.set(row.id, { row, transcript, events: [], observations: [], foldRev: 0, inheritRev: 0, appliedSeq: new Map() });
    },
    held: mutable,
    touchFold: (threadId: string): void => {
      mutable(threadId).foldRev += 1;
    },
    touchInherit: (threadId: string): void => {
      mutable(threadId).inheritRev += 1;
    },
    forget: (threadId: string, tombstones: readonly Tombstone[]): void => {
      for (const { evidence, at } of tombstones) {
        const key = evidenceKey(evidence);
        const standing = world.records.get(key);
        if (standing) world.spent.set(key, { digest: standing.digest, at });
        world.records.delete(key);
      }
      world.threads.delete(threadId);
    },
  });
  return memory;
});

function offPath(): Effect.Effect<never> {
  return Effect.die(new Error('Kernel transitions reached an unused storage operation.'));
}

function versionOf(held: Held): ThreadVersion {
  return { foldRev: held.foldRev, head: held.events.length, inheritRev: held.inheritRev };
}

function callId(evidence: Evidence): string {
  if ('call' in evidence) return evidence.call.id;
  if ('envelope' in evidence) return evidence.envelope.id;
  if ('started' in evidence) return evidence.started.id;
  return '';
}

function cloneWorld(world: World): World {
  const threads = new Map<string, Held>();
  for (const [id, held] of world.threads) {
    threads.set(id, { ...held, events: [...held.events], observations: [...held.observations], appliedSeq: new Map(held.appliedSeq) });
  }
  return { threads, records: new Map(world.records), spent: new Map(world.spent) };
}
