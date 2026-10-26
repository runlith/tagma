import {
  OWN_KINDS,
  type LoadExecution,
  type LoadPoint,
  type LoadProcess,
  type LoadRow,
  type LoadRowKind,
  type LoadTotal,
  type LoadView,
} from '@tagma/server/executions/contract/wire/load';
import { formatBytes } from '$lib/shared/figures.js';

export type Order = 'cpu' | 'memory' | 'name';

export type Shown = { readonly row: LoadRow; readonly processes: readonly LoadProcess[] | null };

export type Listing = {
  readonly installation: readonly Shown[];
  readonly agents: readonly Shown[];
  readonly work: readonly Shown[];
  readonly outside: readonly Shown[];
  readonly minor: readonly Shown[];
  readonly others: LoadTotal | null;
};

const byOrder =
  (order: Order) =>
  (left: LoadRow, right: LoadRow): number =>
    order === 'name'
      ? left.title.localeCompare(right.title)
      : order === 'memory'
        ? right.memoryBytes - left.memoryBytes || right.rank - left.rank
        : right.rank - left.rank || right.memoryBytes - left.memoryBytes;

const found = (text: string | undefined, words: readonly string[]): boolean =>
  text !== undefined && words.every((word) => text.toLowerCase().includes(word));

export const listing = (view: LoadView, order: Order, query: string): Listing => {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  const sorted = view.rows.toSorted(byOrder(order));
  const shown =
    words.length === 0
      ? sorted.map((row): Shown => ({ row, processes: null }))
      : sorted.flatMap((row): Shown[] => {
          if (found(`${row.title} ${row.detail ?? ''} ${row.project?.name ?? ''}`, words)) return [{ row, processes: null }];
          const processes = row.processes.filter((one) => found(`${processTitle(one)} ${one.name} ${one.command ?? ''} ${one.pid}`, words));
          return processes.length === 0 ? [] : [{ row, processes }];
        });
  const of = (kind: LoadRowKind) => shown.filter((one) => one.row.kind === kind);
  const outside = shown.filter((one) => !OWN_KINDS.has(one.row.kind));
  const folding = words.length === 0 && order !== 'name';
  return {
    installation: of('installation'),
    agents: of('agent'),
    work: of('work'),
    outside: folding ? outside.filter((one) => !one.row.minor) : outside,
    minor: folding ? outside.filter((one) => one.row.minor) : [],
    others: folding && view.totals.others.count > 0 ? view.totals.others : null,
  };
};

const NO_WORK: readonly LoadExecution[] = [];

export const threadWork = (row: LoadRow | undefined): readonly LoadExecution[] =>
  row?.work?.executions.filter((one) => !one.session) ?? NO_WORK;

export type Background = LoadView['background'][number];

export const workDone = (work: Background): string =>
  work.total !== null ? `${work.done} / ${work.total}` : work.done > 0 ? `${work.done} done` : 'running';

export const workLeft = (work: Background): string => {
  if (work.remainingMs === null) return '';
  const minutes = Math.round(work.remainingMs / 60_000);
  return minutes < 1 ? 'under a minute left' : `about ${minutes} min left`;
};

export const workShare = (work: Background): number | null => (work.total === null || work.total === 0 ? null : work.done / work.total);

export const backgroundShare = (works: readonly Background[]): number | null => {
  let done = 0;
  let total = 0;
  for (const work of works) {
    if (work.total === null) return null;
    done += work.done;
    total += work.total;
  }
  return total === 0 ? null : done / total;
};

export const percent = (share: number | null): string => {
  if (share === null) return '—';
  const value = share * 100;
  return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`;
};

const ROLES: Record<NonNullable<LoadProcess['role']>, string> = {
  window: 'Tagma window',
  server: 'Tagma server',
  host: 'Execution host',
  holder: 'Process holder',
};

export const processTitle = (one: LoadProcess): string => (one.role === undefined ? one.name : ROLES[one.role]);

export const reapedOf = (one: LoadProcess): number | null =>
  one.share === null || one.reapedShare === undefined || percent(one.reapedShare) === percent(0) ? null : one.reapedShare;

export const reapedWords = (one: LoadProcess, reaped: number): string =>
  `Of its ${percent(one.share)}, ${percent((one.share ?? 0) - reaped)} is its own and ${percent(reaped)} was spent by short-lived child processes it started that ended between readings.`;

export const totalShare = (total: LoadTotal): string => `${total.share !== null && total.unread > 0 ? '≥' : ''}${percent(total.share)}`;

export const detailOf = (row: LoadRow): string =>
  [row.detail, row.kind === 'agent' ? row.project?.name : undefined].filter((part) => part !== undefined && part !== '').join(' · ');

export const heaviest = (view: LoadView, order: Order, count: number): readonly LoadRow[] =>
  view.rows
    .filter((row) => row.kind === 'agent' || row.kind === 'work')
    .toSorted(byOrder(order))
    .slice(0, count);

export const stopWords = (row: LoadRow): string =>
  row.kind === 'agent'
    ? "Stop all of this agent's commands and terminals and what they left running; the agent keeps its turn and gets their outcome"
    : row.work !== undefined
      ? 'Stop this work'
      : `End ${row.title}: terminate, then kill what remains`;

export const totalMemory = (total: LoadTotal): string => (total.memoryBytes === null ? '—' : formatBytes(total.memoryBytes));

export const totalUnread = (total: LoadTotal): string | undefined =>
  total.unread === 0
    ? undefined
    : `${total.unread} ${total.unread === 1 ? 'process was' : 'processes were'} not read this step; the figure counts the rest.`;

export type Spark = { readonly at: number; readonly value: number };

export type Layer = { readonly key: string; readonly fill: string; readonly dot: string };

const TONES = [
  { fill: 'fill-brand', dot: 'bg-brand' },
  { fill: 'fill-status-open', dot: 'bg-status-open' },
  { fill: 'fill-status-done', dot: 'bg-status-done' },
  { fill: 'fill-status-in-work', dot: 'bg-status-in-work' },
] as const;

export const layersOf = (view: LoadView): readonly Layer[] =>
  view.rows
    .filter((row) => OWN_KINDS.has(row.kind))
    .slice(0, TONES.length)
    .map((row, at) => ({ key: row.key, ...TONES[at]! }));

export type Lit =
  | { readonly _tag: 'Layer'; readonly key: string }
  | { readonly _tag: 'Row'; readonly key: string }
  | { readonly _tag: 'Rest' }
  | null;

export const litOf = (view: LoadView, layers: readonly Layer[], key: string | null): Lit => {
  if (key === null) return null;
  if (layers.some((layer) => layer.key === key)) return { _tag: 'Layer', key };
  const row = view.rows.find((one) => one.key === key);
  return row !== undefined && OWN_KINDS.has(row.kind) ? { _tag: 'Rest' } : null;
};

export const sparkOf = (history: readonly LoadPoint[], key: string): readonly Spark[] =>
  history.map((point) => ({ at: point.at, value: point.rows[key] ?? 0 }));
