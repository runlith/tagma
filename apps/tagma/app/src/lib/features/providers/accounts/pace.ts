import type { UsageFigure } from '../usage/windows.js';

const MINUTE_MS = 60_000;
const EARLIEST_JUDGED_SHARE = 0.1;

export type UsagePace = {
  readonly elapsed: number;
  readonly judged: boolean;
  readonly emptyAt: number | null;
};

export function paceOf(figure: UsageFigure, now: number): UsagePace | null {
  if (figure.resetsAt === null) return null;
  const resetsAt = figure.resetsAt * 1000;
  const start = windowStart(figure, resetsAt);
  if (start === null || now <= start || now >= resetsAt) return null;
  const elapsed = (now - start) / (resetsAt - start);
  const judged = elapsed >= EARLIEST_JUDGED_SHARE;
  if (!judged || figure.usedPercent <= 0) return { elapsed, judged, emptyAt: null };
  const emptyAt = now + ((100 - figure.usedPercent) * (now - start)) / figure.usedPercent;
  return { elapsed, judged, emptyAt: emptyAt < resetsAt ? emptyAt : null };
}

function windowStart(figure: UsageFigure, resetsAt: number): number | null {
  if (figure.spanMinutes !== null) return figure.spanMinutes > 0 ? resetsAt - figure.spanMinutes * MINUTE_MS : null;
  if (figure.kind !== 'monthly') return null;
  const start = new Date(resetsAt);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return start.getTime();
}
