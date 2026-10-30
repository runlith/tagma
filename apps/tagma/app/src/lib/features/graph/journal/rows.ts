import type { JournalBatch, MovedBlock } from '@tagma/server/graph/contract/wire/journal';

export type JournalRun = {
  kind: 'run';
  key: string;
  batches: readonly JournalBatch[];
  blockName: string;
  moved?: MovedBlock;
  sessionId: number | null;
  ops: readonly string[];
  entries: number;
  firstTs: string;
  lastTs: string;
  lastEventId: number;
};

export type JournalDay = { kind: 'day'; key: string; label: string };

export type JournalRow = JournalDay | JournalRun;

export const batchKey = (batch: JournalBatch): string => `${batch.blockName}:${batch.firstEventId}`;

export const batchRange = (batch: JournalBatch): { from: number; to: number } => ({
  from: batch.firstEventId - 1,
  to: batch.lastEventId,
});

export const runRange = (run: JournalRun): { from: number; to: number } => ({
  from: (run.batches.at(-1)?.firstEventId ?? 1) - 1,
  to: run.lastEventId,
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const clockOf = (iso: string): string => clock.format(new Date(iso));

const dayStart = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

export function dayLabel(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const today = new Date(now);
  const ago = Math.round((dayStart(today) - dayStart(at)) / 86_400_000);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  const date = `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return at.getFullYear() === today.getFullYear() ? date : `${date}, ${at.getFullYear()}`;
}

const sameRun = (run: JournalRun, batch: JournalBatch): boolean =>
  run.moved === undefined && batch.moved === undefined && run.blockName === batch.blockName && run.sessionId === batch.sessionId;

function joinRun(run: JournalRun, batch: JournalBatch): JournalRun {
  return {
    ...run,
    batches: [...run.batches, batch],
    ops: [...batch.ops.filter((op) => !run.ops.includes(op)), ...run.ops],
    entries: run.entries + batch.entries,
    firstTs: batch.firstTs,
  };
}

export function journalRows(batches: readonly JournalBatch[], now = Date.now()): JournalRow[] {
  const rows: JournalRow[] = [];
  let run: JournalRun | undefined;
  let label = '';
  for (const batch of batches) {
    const day = dayLabel(batch.lastTs, now);
    if (run !== undefined && day === label && sameRun(run, batch)) {
      const joined = joinRun(run, batch);
      rows[rows.length - 1] = joined;
      run = joined;
      continue;
    }
    if (day !== label) rows.push({ kind: 'day', key: `day:${day}:${batch.lastEventId}`, label: day });
    label = day;
    run = {
      kind: 'run',
      key: batchKey(batch),
      batches: [batch],
      blockName: batch.blockName,
      moved: batch.moved,
      sessionId: batch.sessionId,
      ops: batch.ops,
      entries: batch.entries,
      firstTs: batch.firstTs,
      lastTs: batch.lastTs,
      lastEventId: batch.lastEventId,
    };
    rows.push(run);
  }
  return rows;
}
