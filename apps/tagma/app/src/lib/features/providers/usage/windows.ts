import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';

type QuotaObservation = NonNullable<AccountQuotaRow['quota']>;
type QuotaWindow = QuotaObservation['windows'][number];

export type UsageFigure = {
  readonly kind: QuotaWindow['kind'];
  readonly usedPercent: number;
  readonly name: string | null;
  readonly resetsAt: number | null;
  readonly spanMinutes: number | null;
};

const WEEK_MINUTES = 7 * 24 * 60;

const KIND_ORDER: readonly QuotaWindow['kind'][] = ['session', 'weekly', 'monthly', 'model', 'bucket'];

export function usageFigures(quota: AccountQuotaRow['quota']): readonly UsageFigure[] {
  if (!quota) return [];
  return [...quota.windows]
    .map((window, arrival) => ({ window, arrival }))
    .sort(
      (left, right) =>
        KIND_ORDER.indexOf(left.window.kind) - KIND_ORDER.indexOf(right.window.kind) ||
        (left.window.kind === 'bucket' ? (nameOf(left.window) ?? '').localeCompare(nameOf(right.window) ?? '') : 0) ||
        left.arrival - right.arrival,
    )
    .map(({ window }) => ({
      kind: window.kind,
      usedPercent: window.usedPercent,
      name: nameOf(window),
      resetsAt: window.resetsAt ?? null,
      spanMinutes: window.windowMinutes ?? (window.kind === 'weekly' ? WEEK_MINUTES : null),
    }));
}

export function figureText(figure: UsageFigure, now: number): string {
  const reset = figure.resetsAt === null ? null : resetText(figure.resetsAt, now);
  return [usagePercentText(figure.usedPercent), figure.name, ...(reset === null ? [] : ['·', reset])]
    .filter((part) => part !== null)
    .join(' ');
}

export function usagePercentText(usedPercent: number): string {
  const rounded = Math.round(usedPercent);
  if (rounded === 0 && usedPercent > 0) return '<1%';
  if (rounded === 100 && usedPercent < 100) return '99%';
  return `${rounded}%`;
}

export function resetText(resetsAt: number, now: number): string {
  const remaining = resetsAt * 1000 - now;
  if (remaining <= 0) return 'now';
  const minutes = Math.floor(remaining / 60_000);
  if (minutes === 0) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 > 0 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function approxText(durationMs: number): string {
  const minutes = durationMs / 60_000;
  if (minutes < 60) return `~${Math.max(5, Math.round(minutes / 5) * 5)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 > 0 ? `~${days}d ${hours % 24}h` : `~${days}d`;
}

const BAR_KINDS: ReadonlySet<QuotaWindow['kind']> = new Set(['session', 'weekly', 'monthly']);

export function barFigures(figures: readonly UsageFigure[]): readonly UsageFigure[] {
  return figures.filter((figure) => BAR_KINDS.has(figure.kind));
}

export function tightestFigure(figures: readonly UsageFigure[]): UsageFigure | null {
  return figures.reduce<UsageFigure | null>(
    (worst, figure) => (worst === null || figure.usedPercent > worst.usedPercent ? figure : worst),
    null,
  );
}

function nameOf(window: QuotaWindow): string | null {
  switch (window.kind) {
    case 'session':
      return window.windowMinutes === undefined ? null : spanText(window.windowMinutes);
    case 'weekly':
      return window.windowMinutes === undefined ? '7d' : spanText(window.windowMinutes);
    case 'monthly':
      return window.windowMinutes === undefined ? 'mo' : spanText(window.windowMinutes);
    case 'model':
      return window.label ?? window.model ?? null;
    case 'bucket':
      return window.label ?? null;
  }
}

export function spanText(minutes: number): string {
  if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
