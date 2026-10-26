import type { Notification, NotificationsFeedEvent } from '@tagma/server/notify/contract/wire/notification';
import type { AttentionFeedEvent, AttentionKind, AttentionRow } from '@tagma/server/threads/contract/wire/attention';

export type AttentionRows = { readonly rows: readonly AttentionRow[]; readonly total: number };

export type AttentionCounts = { readonly awaiting: number; readonly failed: number; readonly finished: number };

export type AttentionGroup = { readonly kind: AttentionKind; readonly label: string; readonly rows: readonly AttentionRow[] };

export const NONE: AttentionRows = { rows: [], total: 0 };

export const GROUPS: readonly { readonly kind: AttentionKind; readonly label: string }[] = [
  { kind: 'awaiting', label: 'Waiting for you' },
  { kind: 'failed', label: 'Failed' },
  { kind: 'finished', label: 'Done' },
];

const atOf = (row: AttentionRow): number => {
  const at = Date.parse(row.at);
  return Number.isNaN(at) ? 0 : at;
};

const newest = (left: AttentionRow, right: AttentionRow): number =>
  atOf(right) - atOf(left) || (left.threadId < right.threadId ? 1 : left.threadId > right.threadId ? -1 : 0);

export function applyAttention(state: AttentionRows, event: AttentionFeedEvent): AttentionRows {
  if (event.type === 'list') return { rows: [...event.rows].sort(newest), total: event.total };
  const gone = new Set([...event.removed, ...event.rows.map((row) => row.threadId)]);
  const kept = state.rows.filter((row) => !gone.has(row.threadId));
  return { rows: [...kept, ...event.rows].sort(newest), total: event.total };
}

export function countsOf(rows: readonly AttentionRow[]): AttentionCounts {
  let awaiting = 0;
  let failed = 0;
  let finished = 0;
  for (const row of rows) {
    if (row.kind === 'awaiting') awaiting += 1;
    else if (row.kind === 'failed') failed += 1;
    else finished += 1;
  }
  return { awaiting, failed, finished };
}

export function groupsOf(rows: readonly AttentionRow[]): readonly AttentionGroup[] {
  return GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.kind === group.kind) })).filter(
    (group) => group.rows.length > 0,
  );
}

export function titleOf(row: AttentionRow): string {
  if (row.title.trim() !== '') return row.title;
  return row.name ?? 'Untitled thread';
}

export function readingOf(row: AttentionRow): string {
  if (row.kind === 'awaiting') return row.ask?.text ?? 'Waiting for your answer';
  if (row.kind === 'finished') return row.said ?? 'Finished, not read';
  const failure = row.failure;
  const ending = failure?.ending === 'cut' ? 'Cut off' : 'Failed';
  const detail = failure?.reason ?? failure?.detail ?? failure?.type ?? null;
  const status = failure?.httpStatus ?? null;
  const said = [status === null ? null : String(status), detail].filter((part): part is string => part !== null).join(' · ');
  return said === '' ? ending : said;
}

export function unreadOf(rows: readonly AttentionRow[]): readonly (AttentionRow & { readonly runId: string })[] {
  return rows.filter((row): row is AttentionRow & { readonly runId: string } => row.kind !== 'awaiting' && row.runId !== null);
}

const newestNotification = (left: Notification, right: Notification): number =>
  Date.parse(right.at) - Date.parse(left.at) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0);

export function applyNotifications(held: readonly Notification[], event: NotificationsFeedEvent): readonly Notification[] {
  if (event.type === 'list') return [...event.rows].sort(newestNotification);
  if (event.type === 'gone') return held.filter((row) => row.id !== event.id);
  return [...held.filter((row) => row.id !== event.row.id), event.row].sort(newestNotification);
}

export function notificationCountsOf(rows: readonly Notification[]): { readonly asking: number; readonly telling: number } {
  const asking = rows.filter((row) => row.question !== null).length;
  return { asking, telling: rows.length - asking };
}
