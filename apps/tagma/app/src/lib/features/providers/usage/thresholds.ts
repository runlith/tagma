import { paceOf } from '../accounts/pace.js';
import { approxText, resetText, type UsageFigure } from './windows.js';

export const USAGE_SPENT_PERCENT = 95;
export const USAGE_TIGHT_PERCENT = 80;

export type UsageTone = 'plain' | 'warning' | 'alarm';

export type FigureReading = {
  readonly tone: UsageTone;
  readonly emptyAt: number | null;
};

export function figureReading(figure: UsageFigure, now: number): FigureReading {
  if (figure.usedPercent >= USAGE_SPENT_PERCENT) return { tone: 'alarm', emptyAt: null };
  const pace = paceOf(figure, now);
  if (pace !== null && pace.judged) return { tone: pace.emptyAt === null ? 'plain' : 'warning', emptyAt: pace.emptyAt };
  return { tone: figure.usedPercent >= USAGE_TIGHT_PERCENT ? 'warning' : 'plain', emptyAt: null };
}

export function figureTone(figure: UsageFigure, now: number): UsageTone {
  return figureReading(figure, now).tone;
}

export function figureWhen(figure: UsageFigure, now: number): string | null {
  const { emptyAt } = figureReading(figure, now);
  if (emptyAt !== null) return `empty in ${approxText(emptyAt - now)}`;
  return figure.resetsAt === null ? null : `resets in ${resetText(figure.resetsAt, now)}`;
}
