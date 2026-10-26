import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
import { timeAgo } from '$lib/shared/time.js';
import { NOT_INSTALLED } from '../served.js';
import type { UsageTone } from '../usage/thresholds.js';
import { resetText } from '../usage/windows.js';

type QuotaFailure = NonNullable<AccountQuotaRow['failure']>;

export type UsageStatus = {
  readonly word: string | null;
  readonly tone: UsageTone;
  readonly stale: boolean;
  readonly note: string | null;
};

const STALE_AFTER_MS = 2 * 15 * 60_000;

export function readingAt(row: AccountQuotaRow): number | null {
  return row.quota?.observedAt.getTime() ?? null;
}

export type UsageNeed = 'sign-in' | 'new-key';

export const NEED_WORDS: Record<UsageNeed, string> = {
  'sign-in': 'Sign in again',
  'new-key': 'Replace key',
};

function keyExpiry(row: AccountQuotaRow, served: ServedProvider | undefined, now: number): number | null {
  return served?.kind === 'harness' &&
    served.auth === 'api-key' &&
    row.expiresAt !== undefined &&
    row.expiresAt - now <= 7 * 24 * 60 * 60_000
    ? row.expiresAt
    : null;
}

export function usageNeed(row: AccountQuotaRow, served: ServedProvider | undefined, now = Date.now()): UsageNeed | null {
  if (keyExpiry(row, served, now) !== null) return 'sign-in';
  if (row.problem?.kind === 'signed-out') return 'sign-in';
  const tag = row.failure?._tag;
  return tag === 'stale-token' || tag === 'missing-scope' ? needOf(row, served) : null;
}

function needOf(row: AccountQuotaRow, served: ServedProvider | undefined): UsageNeed {
  if (served?.auth === 'api-key' && served.kind !== 'harness') return 'new-key';
  return 'sign-in';
}

export type UsageAbsence = 'reading' | 'unmeasured' | 'unread';

export function usageAbsence(row: AccountQuotaRow, served: ServedProvider | undefined): UsageAbsence {
  if (standsAlone(row, served) || row.failure?._tag === 'unsupported') return 'unmeasured';
  if (row.failure !== null) return 'unread';
  return row.quota === null ? 'reading' : 'unmeasured';
}

export function reportsUsage(row: AccountQuotaRow, served: ServedProvider | undefined): boolean {
  return (row.quota?.windows.length ?? 0) > 0 || usageNeed(row, served) !== null || usageAbsence(row, served) !== 'unmeasured';
}

const standsAlone = (row: AccountQuotaRow, served: ServedProvider | undefined): boolean =>
  served?.quotaFromReplies === true && (row.quota?.windows.length ?? 0) === 0;

export function usageStatus(row: AccountQuotaRow, served: ServedProvider | undefined, now: number): UsageStatus {
  const expiresAt = keyExpiry(row, served, now);
  if (expiresAt !== null)
    return {
      word: 'Sign in again',
      tone: 'warning',
      stale: expiresAt <= now,
      note: expiresAt <= now ? 'The API key expired' : `The API key expires ${new Date(expiresAt).toLocaleDateString()}`,
    };
  if (row.problem !== null) {
    if (row.problem.kind === 'signed-out')
      return {
        word: 'Signed out',
        tone: 'warning',
        stale: true,
        note: row.origin.kind === 'cli' ? 'Sign in with its CLI' : 'Sign in again',
      };
    return row.problem.kind === 'not-installed'
      ? { word: NOT_INSTALLED, tone: 'warning', stale: false, note: 'no installed adapter provides this account' }
      : { word: 'Credential unreadable', tone: 'alarm', stale: false, note: row.problem.reason };
  }
  const failure = row.failure;
  const read = readingAt(row);
  const silent = standsAlone(row, served);
  const stale = failure !== null || row.restored || (read !== null && (now - read > STALE_AFTER_MS || pastReset(row, now)));
  const spoken = failure === null ? (row.quota === null ? 'Not read yet' : null) : wordOf(failure, row, served, now);
  return {
    word: silent || (row.quota?.windows.length ?? 0) > 0 ? null : spoken,
    tone: failure === null ? 'plain' : toneOf(failure, row.origin),
    stale,
    note: stale && !silent ? noteOf(failure, row.restored, read, now) : null,
  };
}

function pastReset(row: AccountQuotaRow, now: number): boolean {
  return (row.quota?.windows ?? []).some((window) => window.resetsAt !== undefined && window.resetsAt * 1000 <= now);
}

function wordOf(failure: QuotaFailure, row: AccountQuotaRow, served: ServedProvider | undefined, now: number): string {
  switch (failure._tag) {
    case 'stale-token':
    case 'missing-scope':
      return NEED_WORDS[needOf(row, served)];
    case 'rate-limited':
      return failure.retryAfterMs === undefined || row.failedAt === null
        ? 'Rate limited'
        : `Rate limited · ${resetText((row.failedAt + failure.retryAfterMs) / 1000, now)}`;
    case 'unavailable':
      return 'Usage unknown';
    case 'unsupported':
      return 'No usage reported';
    case 'server':
    case 'transport':
    case 'invalid-response':
      return 'Usage unavailable';
  }
}

function toneOf(failure: QuotaFailure, origin: AccountQuotaRow['origin']): UsageTone {
  switch (failure._tag) {
    case 'stale-token':
    case 'missing-scope':
      return origin.kind === 'cli' ? 'warning' : 'alarm';
    case 'rate-limited':
      return 'alarm';
    case 'server':
    case 'transport':
    case 'invalid-response':
    case 'unsupported':
    case 'unavailable':
      return 'plain';
  }
}

export function updatedAgo(updatedAt: number, now: number): string {
  const age = timeAgo(new Date(updatedAt).toISOString(), now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

function noteOf(failure: AccountQuotaRow['failure'], restored: boolean, readAt: number | null, now: number): string | null {
  const parts = [
    failure === null ? null : reasonOf(failure),
    restored ? 'last known before the server restarted' : null,
    readAt === null ? null : `updated ${updatedAgo(readAt, now)}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

export function failureReason(row: AccountQuotaRow, served: ServedProvider | undefined): string | null {
  return row.failure === null || standsAlone(row, served) ? null : reasonOf(row.failure);
}

function reasonOf(failure: QuotaFailure): string {
  switch (failure._tag) {
    case 'stale-token':
      return 'the stored credential no longer signs';
    case 'missing-scope':
      return `the grant is missing ${failure.scope}`;
    case 'rate-limited':
      return 'the provider is refusing calls';
    case 'server':
      return `the provider answered ${failure.status}`;
    case 'transport':
      return 'the provider could not be reached';
    case 'invalid-response':
      return 'the provider answered something else';
    case 'unavailable':
      return failure.reason;
    case 'unsupported':
      return 'this provider reports no usage to Tagma';
  }
}
