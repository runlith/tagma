import {
  OWN_KINDS,
  type LoadExecution,
  type LoadPoint,
  type LoadProcess,
  type LoadRow,
  type LoadTotal,
  type LoadView,
} from '@tagma/server/executions/contract/wire/load';
import { formatBytes } from '$lib/shared/figures.js';

export type Order = 'cpu' | 'memory' | 'name';

export type Shown = { readonly row: LoadRow; readonly processes: readonly LoadProcess[] | null };

export type Listing = {
  readonly own: readonly Shown[];
  readonly idle: readonly Shown[];
  readonly outside: readonly Shown[];
  readonly minor: readonly Shown[];
  readonly others: LoadTotal | null;
};

const IDLE = 0.001;

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
  const own = shown.filter((one) => OWN_KINDS.has(one.row.kind));
  const outside = shown.filter((one) => !OWN_KINDS.has(one.row.kind));
  const folding = words.length === 0 && order !== 'name';
  const idling = words.length === 0 && order === 'cpu';
  return {
    own: idling ? own.filter((one) => one.row.rank >= IDLE) : own,
    idle: idling ? own.filter((one) => one.row.rank < IDLE) : [],
    outside: folding ? outside.filter((one) => !one.row.minor) : outside,
    minor: folding ? outside.filter((one) => one.row.minor) : [],
    others: folding && view.totals.others.count > 0 ? view.totals.others : null,
  };
};

export const idleTotal = (rows: readonly Shown[]): LoadTotal => ({
  count: rows.length,
  share: rows.reduce((sum, one) => sum + one.row.share, 0),
  memoryBytes: rows.reduce((sum, one) => sum + one.row.memoryBytes, 0),
  unread: rows.reduce((sum, one) => sum + one.row.unread, 0),
});

const NO_WORK: readonly LoadExecution[] = [];

export const threadWork = (row: LoadRow | undefined): readonly LoadExecution[] =>
  row?.work?.executions.filter((one) => !one.session) ?? NO_WORK;

export type ProcessBranch = { readonly process: LoadProcess; readonly depth: number };

export type ExecutionLoad = { readonly execution: LoadExecution; readonly row: LoadRow };

const NO_BRANCHES: readonly ProcessBranch[] = [];

export const executionProcesses = (row: LoadRow, key: string): readonly ProcessBranch[] => {
  const own = row.processes.filter((one) => one.execution === key);
  if (own.length === 0) return NO_BRANCHES;
  const pids = new Set(own.map((one) => one.pid));
  const children = new Map<number | null, LoadProcess[]>();
  for (const one of own) {
    const parent = one.parent !== undefined && pids.has(one.parent) ? one.parent : null;
    const held = children.get(parent);
    if (held === undefined) children.set(parent, [one]);
    else held.push(one);
  }
  const branches: ProcessBranch[] = [];
  const walk = (parent: number | null, depth: number): void => {
    for (const one of (children.get(parent) ?? []).toSorted((left, right) => left.pid - right.pid)) {
      branches.push({ process: one, depth });
      walk(one.pid, depth + 1);
    }
  };
  walk(null, 0);
  return branches;
};

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
    .filter((row) => OWN_KINDS.has(row.kind))
    .toSorted(byOrder(order))
    .slice(0, count);

export const stopWords = (row: LoadRow): string =>
  row.kind === 'agent'
    ? "Stop all of this agent's commands and terminals and what they left running; the agent keeps its turn and gets their outcome"
    : row.close !== undefined
      ? row.close.length === 1
        ? 'Close the page this process draws'
        : `Close the ${row.close.length} pages this process draws`
      : row.work !== undefined
        ? 'Stop this work'
        : `End ${row.title}: terminate, then kill what remains`;

export const shareWords = (row: LoadRow): string | undefined =>
  [
    row.unread === 0
      ? undefined
      : `${row.unread} of its ${row.processes.length} processes were not read this step; the figure counts the rest.`,
    row.lowerBound === true ? 'Processes born and gone between readings are not counted, so the figure is at least this much.' : undefined,
  ]
    .filter((one) => one !== undefined)
    .join('\n') || undefined;

export const gpuMeasured = (view: LoadView): boolean => view.gpu._tag === 'Measured';

export const gpuWords = (view: LoadView): string | undefined =>
  view.gpu._tag === 'Unavailable' ? `GPU is not measured on this system: ${view.gpu.reason}` : undefined;

export const rowGpu = (row: LoadRow): { readonly text: string; readonly hint: string | undefined } => ({
  text: row.gpuUnread === row.processes.length && row.gpu === 0 ? '—' : `${row.gpuUnread > 0 ? '≥' : ''}${percent(row.gpu)}`,
  hint:
    row.gpuUnread === 0
      ? undefined
      : `${row.gpuUnread} of its ${row.processes.length} processes have no GPU measurement; the figure counts the rest.`,
});

export const unresolvedWords = (view: LoadView): string | undefined => {
  if (view.unresolved.length === 0) return undefined;
  const lines = view.unresolved.map(
    (one) =>
      `${one.title} (pid ${one.pid}): ${one.reason === 'different' ? 'that pid now names another process' : 'its start could not be read'}`,
  );
  return `${view.unresolved.length === 1 ? 'A window process' : `${view.unresolved.length} window processes`} could not be matched on this ${view.machine}, so ${view.unresolved.length === 1 ? 'its' : 'their'} load counts outside Tagma.\n${lines.join('\n')}`;
};

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
