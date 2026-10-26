export type ThreadOpenStage = 'select' | 'subscribe' | 'apply' | 'frame';

export type ThreadOpenTiming =
  | {
      readonly kind: 'chat';
      readonly host: number;
      readonly threadId: string;
      readonly entries: number;
      readonly replayed: boolean;
      readonly reached: ThreadOpenStage;
      readonly selectToSubscribeMs: number | null;
      readonly subscribeWaitMs: number | null;
      readonly applyMs: number | null;
      readonly applyToFrameMs: number | null;
      readonly totalMs: number;
    }
  | {
      readonly kind: 'harness';
      readonly host: number;
      readonly threadId: string;
      readonly recordMs: number | null;
      readonly engineMs: number | null;
      readonly attachMs: number | null;
      readonly replayMs: number | null;
      readonly paintMs: number | null;
      readonly totalMs: number;
    };

export type ThreadOpenDecline = 'reselect' | 'unreadable' | 'closed' | 'harness' | 'hidden' | 'stale' | 'standing';

export type ThreadOpenTally = {
  measured: number;
  unfinished: number;
  dropped: number;
  declined: number;
  reasons: Record<ThreadOpenDecline, number>;
};

export const THREAD_OPEN = 'tagma.thread-open';
export const THREAD_OPEN_TALLY = 'tagma.thread-open.tally';

const KEPT = 64;
const listeners = new Set<(timing: ThreadOpenTiming, startedAt: number) => void>();

export function onThreadOpen(listener: (timing: ThreadOpenTiming, startedAt: number) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function none(): ThreadOpenTally {
  return {
    measured: 0,
    unfinished: 0,
    dropped: 0,
    declined: 0,
    reasons: { reselect: 0, unreadable: 0, closed: 0, harness: 0, hidden: 0, stale: 0, standing: 0 },
  };
}

export function threadOpens(): readonly PerformanceMeasure[] {
  return performance.getEntriesByName(THREAD_OPEN, 'measure') as PerformanceMeasure[];
}

export function threadOpenTally(): ThreadOpenTally {
  const mark = performance.getEntriesByName(THREAD_OPEN_TALLY, 'mark').at(-1) as PerformanceMark | undefined;
  const standing = mark?.detail as ThreadOpenTally | undefined;
  if (standing === undefined) return none();
  return { ...standing, reasons: { ...standing.reasons } };
}

export function recordThreadOpen(timing: ThreadOpenTiming, startedAt: number): void {
  performance.measure(THREAD_OPEN, { detail: timing, start: startedAt, duration: timing.totalMs });
  const tally = threadOpenTally();
  tally.measured += 1;
  if (timing.kind === 'chat' ? timing.reached !== 'frame' : timing.paintMs === null) tally.unfinished += 1;
  const standing = threadOpens();
  if (standing.length > KEPT * 2) {
    const newest = standing.slice(-KEPT).map((entry) => ({ detail: entry.detail, start: entry.startTime, duration: entry.duration }));
    performance.clearMeasures(THREAD_OPEN);
    for (const entry of newest) performance.measure(THREAD_OPEN, entry);
    tally.dropped += standing.length - newest.length;
  }
  writeTally(tally);
  for (const listener of listeners) listener(timing, startedAt);
}

export function declineThreadOpen(reason: ThreadOpenDecline): void {
  const tally = threadOpenTally();
  tally.declined += 1;
  tally.reasons[reason] += 1;
  writeTally(tally);
}

function writeTally(tally: ThreadOpenTally): void {
  performance.clearMarks(THREAD_OPEN_TALLY);
  performance.mark(THREAD_OPEN_TALLY, { detail: tally });
}
