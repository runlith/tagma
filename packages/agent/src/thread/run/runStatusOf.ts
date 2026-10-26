import type { InputReceipt, RunStatus, RunStatusEnding, ThreadPendingInput, WordsWait } from '../../transcript/live';
import type { ThreadMetadataRow, ThreadRunRow } from '../rows';
import type { ThreadRunLeaseRhythm } from '../ThreadPorts';
import type { RunEnding } from './lifecycle/endings';
import { runHalt, runSignals } from '../state';
import { isRefusal, type KeyedRecord } from './scheduler/answers';

export type RunStatusReading = {
  readonly status: RunStatus;
  readonly changesAt: Date | null;
};

export type RecordedReceipt = { readonly key: string; readonly status: InputReceipt['status']; readonly runId: string };

export type RunStatusRows = {
  readonly thread: ThreadMetadataRow;
  readonly activeRun: ThreadRunRow | null;
  readonly pendingInput: ThreadPendingInput;
  readonly openQuestions: readonly string[];
  readonly recorded: ReadonlyMap<string, RecordedReceipt>;
  readonly launchBlocked: boolean;
  readonly wordsWait: WordsWait | null;
};

export function recordedReceiptOf(key: string, record: KeyedRecord | null): RecordedReceipt | null {
  if (record === null || isRefusal(record)) return null;
  if (record.status !== 'queued' && record.status !== 'steered') return null;
  return { key, status: record.status, runId: record.runId };
}

function receiptsOf(pending: ThreadPendingInput, recorded: ReadonlyMap<string, RecordedReceipt>): readonly InputReceipt[] {
  const receipts: InputReceipt[] = [];
  for (const turn of [...pending.queued, ...pending.steers]) {
    const receipt = recorded.get(turn.id);
    if (receipt !== undefined) receipts.push({ ...receipt, itemId: turn.id, occurredAt: turn.occurredAt });
  }
  return receipts;
}

export function endingOf(ending: RunEnding): RunStatusEnding {
  return {
    runId: ending.runId,
    status: ending.status,
    stoppedBy: ending.stoppedBy,
    failureReason: ending.failureReason,
    finishedAt: ending.finishedAt.toISOString(),
    notification: ending.notification.state,
    words: ending.words ?? undefined,
  };
}

export function runStatusOf(rows: RunStatusRows, now: Date, rhythm: ThreadRunLeaseRhythm, ended: RunEnding | null): RunStatusReading {
  const { thread, activeRun, pendingInput } = rows;
  const receipts = receiptsOf(pendingInput, rows.recorded);
  if (activeRun === null) {
    return {
      status: {
        threadId: thread.id,
        runId: null,
        life: 'idle',
        stage: null,
        openQuestions: [],
        since: null,
        ending: ended === null ? undefined : endingOf(ended),
        launchBlocked: rows.launchBlocked ? (true as const) : undefined,
        wordsWait: rows.wordsWait ?? undefined,
        receipts,
      },
      changesAt: null,
    };
  }
  const signals = runSignals(activeRun, thread, now, rhythm);
  return {
    status: {
      threadId: thread.id,
      runId: activeRun.id,
      life: signals?.life ?? 'working',
      stage: activeRun.progress.stage,
      openQuestions: rows.openQuestions,
      since: activeRun.startedAt.toISOString(),
      ownership: signals === null ? undefined : signals.ownership,
      halt: runHalt(activeRun),
      launchBlocked: rows.launchBlocked ? (true as const) : undefined,
      wordsWait: rows.wordsWait ?? undefined,
      receipts,
    },
    changesAt: signals?.changesAt ?? null,
  };
}
