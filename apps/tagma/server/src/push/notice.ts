import type { Notification } from '../notify/contract/wire/notification.js';
import type { AttentionRow } from '../threads/contract/wire/attention.js';
import { NOTICE_BYTES, type Notice, notificationTag } from './contract/wire/push.js';

const TITLE_CHARS = 120;
const BODY_CHARS = [240, 120, 40] as const;

export type Alert = {
  readonly subject: string;
  readonly eventId: string;
  readonly at: number;
  readonly counts: boolean;
  readonly high: boolean;
  readonly title: string;
  readonly said: string;
  readonly url: string;
};

const cut = (text: string, limit: number): string => {
  const chars = [...text];
  return chars.length > limit
    ? `${chars
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`
    : text;
};

const said = (row: AttentionRow): string => {
  if (row.kind === 'awaiting') return row.ask?.text ?? 'Waiting for you';
  if (row.kind === 'finished') return row.said ?? 'Finished';
  const failure = row.failure;
  return `Failed: ${failure?.reason ?? failure?.detail ?? failure?.type ?? (failure?.ending === 'cut' ? 'the run was cut' : 'the run failed')}`;
};

export const threadAlert = (row: AttentionRow): Alert => ({
  subject: row.threadId,
  eventId: row.eventId,
  at: Date.parse(row.at),
  counts: row.kind !== 'finished',
  high: row.kind === 'awaiting',
  title: `${row.project.name} · ${row.title}`,
  said: said(row),
  url: `/${encodeURIComponent(row.project.name)}/chat/${encodeURIComponent(row.threadId)}`,
});

export const notificationAlert = (notification: Notification): Alert => ({
  subject: notificationTag(notification.id),
  eventId: notification.id,
  at: Date.parse(notification.at),
  counts: notification.question !== null,
  high: notification.question !== null,
  title: notification.title,
  said: notification.question?.text ?? notification.body,
  url: `/?notification=${encodeURIComponent(notification.id)}`,
});

export function noticeOf(alert: Alert, badge: number): string | null {
  const title = cut(alert.title, TITLE_CHARS);
  for (const chars of BODY_CHARS) {
    const notice: Notice = { title, body: cut(alert.said, chars), url: alert.url, tag: alert.subject, badge };
    const payload = JSON.stringify(notice);
    if (Buffer.byteLength(payload) <= NOTICE_BYTES) return payload;
  }
  return null;
}
