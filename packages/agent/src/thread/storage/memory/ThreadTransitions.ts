import { Clock, Effect } from 'effect';
import type { ThreadPortFailure } from '../../ThreadBorder';
import { attempt } from './attempt';
import { applyThreadEntryPlacements } from '../../../transcript/eventFold';
import { callParts, evidenceKey, mintedBefore, REPORT_OPERATION, REPORT_WINDOW, type CallParts, type Evidence } from '../../keyed';
import type { ThreadRow } from '../../rows';
import { SequenceUnavailable, ThreadVersionStaleError } from '../../transition/port';
import type { RecordReading, ThreadAt, ThreadHold, ThreadTransitionStorage, ThreadVersion } from '../../transition/port';
import { applyColumns, headOf, historyOf, project } from './folds';
import type { HeldThread, MemoryStorageInput } from './state';
import { MemoryTx } from './units';

const SNAPSHOT_ATTEMPTS = 8;

export const inMemoryThreadTransitions = ({ memory }: MemoryStorageInput): ThreadTransitionStorage<MemoryTx> => {
  const forgotten = (parts: CallParts): RecordReading => {
    const spent = memory.spent.get(spentKey(parts));
    if (spent) return { kind: 'spent', digest: spent.digest, at: spent.at };
    return mintedBefore(parts.key, memory.epoch) ? { kind: 'before-epoch' } : { kind: 'absent' };
  };

  const reportKeys = (runId: string): string[] => {
    const prefix = evidenceKey({ call: { namespace: `${REPORT_OPERATION}:${runId}`, id: '' } });
    return [...memory.records.keys()].filter((key) => key.startsWith(prefix));
  };

  const hold = <T, E>(
    threadId: string,
    work: (at: ThreadHold<MemoryTx>) => Effect.Effect<T, E>,
    tx: MemoryTx,
  ): Effect.Effect<T | undefined, E | ThreadPortFailure> =>
    Effect.suspend(() => {
      const held = memory.held(threadId);
      return held ? work({ row: held.row, version: versionOf(held), tx }) : Effect.succeed(undefined);
    });

  const reading = (threadId: string, evidence: Evidence): RecordReading => {
    if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return { kind: 'decided' };
    if ('seq' in evidence) {
      const run = memory.runs.get(evidence.run);
      if (!run || run.threadId !== threadId) throw new SequenceUnavailable(evidence.run, evidence.seq, 'absent');
      const applied = run.appliedSeq;
      if (run.status !== 'running') throw new SequenceUnavailable(evidence.run, evidence.seq, 'ended');
      if (evidence.seq < applied) throw new SequenceUnavailable(evidence.run, evidence.seq, 'advanced');
      if (evidence.seq > applied + 1) {
        throw new Error(`Run ${evidence.run} stands at sequence ${applied}, so sequence ${evidence.seq} would leave a gap.`);
      }
      const standing = evidence.seq === applied ? run.receipt : null;
      if (standing) return { kind: 'present', digest: standing.digest, result: standing.result };
      if (evidence.seq <= applied) {
        throw new Error(`Run ${evidence.run} applied sequence ${applied} but holds no record of sequence ${evidence.seq}.`);
      }
      return { kind: 'absent' };
    }
    if ('started' in evidence) {
      const parts = callParts(evidence.started);
      const run = [...memory.runs.values()].find((candidate) => candidate.threadId === parts.actor && candidate.startKey === parts.key);
      if (!run) return forgotten(parts);
      return run.startDigest === null ? { kind: 'decided' } : { kind: 'present', digest: run.startDigest, result: run.id };
    }
    if ('runEnd' in evidence) {
      const run = memory.runs.get(evidence.runEnd);
      if (!run || run.status === 'running') return { kind: 'absent' };
      if (run.endDigest === null || run.status !== evidence.status) return { kind: 'decided' };
      return { kind: 'present', digest: run.endDigest, result: run.endResult };
    }
    const standing = memory.records.get(evidenceKey(evidence));
    if ('envelope' in evidence) {
      return standing ? { kind: 'standing', digest: standing.digest } : forgotten(callParts(evidence.envelope));
    }
    return standing ? { kind: 'present', digest: standing.digest, result: standing.result } : forgotten(callParts(evidence.call));
  };

  return {
    readAt: Effect.fnUntraced(function* <T, E>(
      threadId: string,
      work: (at: ThreadAt<MemoryTx>) => Effect.Effect<T, E>,
      tx?: MemoryTx,
    ): Effect.fn.Return<T | undefined, E | ThreadPortFailure> {
      for (let round = 1; ; round += 1) {
        const seen = yield* attempt('readAt', () =>
          memory.read(tx, () => {
            const held = memory.held(threadId);
            if (!held) return undefined;
            const row: ThreadRow = {
              ...held.row,
              history: historyOf(memory.kinds, held),
              systemPrompt: held.systemPrompt,
              pendingSystemPrompt: held.pendingSystemPrompt,
            };
            return { row, version: versionOf(held) };
          }),
        );
        if (!seen) return undefined;
        const before = seen.version;
        const made = yield* work({ row: seen.row, version: before, tx: tx ?? new MemoryTx({ clock: yield* Clock.Clock, reads: true }) });
        const after = yield* attempt('readAt', () =>
          memory.read(tx, () => {
            const held = memory.held(threadId);
            return held && versionOf(held);
          }),
        );
        if (after !== undefined && sameVersion(before, after)) return made;
        if (round === SNAPSHOT_ATTEMPTS) return yield* Effect.fail(new ThreadVersionStaleError({ threadId }));
      }
    }),

    writeAt: (threadId, work) => memory.units.commit((tx) => hold(threadId, work, tx)),

    writeAtIn: hold,

    writeFold: (threadId, write, tx) =>
      attempt('writeFold', () => {
        if (Object.keys(write.fold).length === 0) return;
        const held = memory.held(threadId);
        if (!held) return;
        tx.keep(held);
        const { history, covered, placements, cacheObservations, ...columns } = write.fold;
        if (history !== undefined) {
          if (covered !== undefined && covered !== null && (covered.from > write.standing || covered.through < write.standing)) {
            throw new Error(
              `Thread ${threadId}: the returned history was folded over positions ${covered.from + 1}-${covered.through}, but the log stood at ${write.standing} when the history was read. The facts between are covered by no fold, so this unit cannot advance the history cursor.`,
            );
          }
          held.history = [...history];
          held.historyThrough = covered === undefined || covered === null ? write.standing : covered.through;
        }
        const claimed = project(memory.kinds, held);
        if (placements !== undefined && placements.length > 0) {
          held.transcript = [
            ...applyThreadEntryPlacements(
              held.transcript,
              placements.filter(
                (placement) => placement.kind === 'withdraw' || placement.kind === 'mark' || !claimed.has(placement.entry.id),
              ),
            ),
          ];
        }
        if (cacheObservations !== undefined) held.observations.push(...cacheObservations);
        applyColumns(held, columns, write.at);
      }),

    readRecord: (threadId, evidence, tx) => attempt('readRecord', () => memory.read(tx, () => reading(threadId, evidence))),

    writeRecord: (threadId, evidence, write, tx) =>
      attempt('writeRecord', () => {
        if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return;
        if ('seq' in evidence) {
          const run = memory.runs.get(evidence.run);
          if (!run) return;
          tx.keep(run);
          run.receipt = { digest: write.digest, result: write.result };
          run.appliedSeq = evidence.seq;
          return;
        }
        if ('runEnd' in evidence) {
          const run = memory.runs.get(evidence.runEnd);
          if (!run) return;
          tx.keep(run);
          run.endDigest = write.digest;
          run.endResult = write.result ?? null;
          for (const key of reportKeys(evidence.runEnd)) tx.remove(memory.records, key);
          return;
        }
        if ('started' in evidence) {
          throw new Error(`Start ${evidence.started.id} is keyed on the run row its creation wrote, never recorded after it.`);
        }
        const parts = callParts('envelope' in evidence ? evidence.envelope : evidence.call);
        tx.put(memory.records, evidenceKey(evidence), { ...write, threadId, spentAs: spentKey(parts) });
        if (parts.operation === REPORT_OPERATION) {
          for (const key of reportKeys(parts.actor).slice(0, -REPORT_WINDOW)) tx.remove(memory.records, key);
        }
      }),

    appliedSeq: (runId) => attempt('appliedSeq', () => memory.read(undefined, () => memory.runs.get(runId)?.appliedSeq ?? 0)),

    spend: (threadIds, at, tx) =>
      attempt('spend', () => {
        const ending = new Set(threadIds);
        for (const [key, record] of memory.records) {
          if (!ending.has(record.threadId)) continue;
          tx.put(memory.spent, record.spentAs, { digest: record.digest, at });
          tx.remove(memory.records, key);
        }
        for (const run of memory.runs.values()) {
          if (!ending.has(run.threadId) || run.startKey === null || run.startDigest === null) continue;
          tx.put(memory.spent, spentKey({ operation: 'start', actor: run.threadId, key: run.startKey }), {
            digest: run.startDigest,
            at,
          });
        }
      }),

    revision: () => Effect.sync(() => memory.units.revision()),

    opened: () => Effect.void,

    revised: (threadIds, tx, after) =>
      Effect.suspend(() => {
        const from = memory.units.revision();
        return tx.afterCommit(after(new Map(threadIds.map((threadId) => [threadId, { from, to: from + 1 }]))));
      }),
  };
};

function spentKey(parts: CallParts): string {
  return evidenceKey({ call: { namespace: `${parts.operation}:${parts.actor}`, id: parts.key } });
}

function versionOf(held: HeldThread): ThreadVersion {
  return { foldRev: held.foldRev, head: headOf(held), inheritRev: held.inheritRev };
}

function sameVersion(left: ThreadVersion, right: ThreadVersion): boolean {
  return left.foldRev === right.foldRev && left.head === right.head && left.inheritRev === right.inheritRev;
}
