import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { expect, test } from 'vitest';
import { servedProvider } from '../testing.js';
import { usageNeed, usageStatus } from './status.js';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function row(fields: Partial<AccountQuotaRow>): AccountQuotaRow {
  return {
    provider: 'subscription',
    account: 'k1',
    label: 'work@example.com',
    origin: { kind: 'own' },
    default: true,
    quota: null,
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    ...fields,
  } as AccountQuotaRow;
}

const readAt = (moment: number, windows: readonly QuotaWindow[] = [new QuotaWindow({ kind: 'session', usedPercent: 13 })]) =>
  new QuotaObservation({ observedAt: new Date(moment), source: 'usage', windows });

const SUBSCRIPTION = servedProvider({ id: 'subscription', models: {}, defaultTextModel: 'none' });
const FROM_REPLIES = servedProvider({ id: 'stepfun', auth: 'api-key', quotaFromReplies: true, models: {}, defaultTextModel: 'none' });

const stepfun = (fields: Partial<AccountQuotaRow> = {}) => row({ provider: 'stepfun', ...fields });

test('a StepFun row stands as its mark alone, and a provider that really reports nothing keeps its word', () => {
  const unsupported = { _tag: 'unsupported' } as AccountQuotaRow['failure'];

  const alone = usageStatus(stepfun({ failure: unsupported, failedAt: NOW }), FROM_REPLIES, NOW);
  expect(alone.word).toBeNull();
  expect(alone.note).toBeNull();
  expect(alone.tone).toBe('plain');

  expect(usageStatus(row({ provider: 'kimi-oauth', failure: unsupported, failedAt: NOW }), SUBSCRIPTION, NOW).word).toBe(
    'No usage reported',
  );

  expect(
    usageStatus(stepfun({ quota: readAt(NOW), failure: unsupported, failedAt: NOW + HOUR }), FROM_REPLIES, NOW + HOUR).word,
  ).toBeNull();
});

test('a row nobody has read yet says so, and says nothing else', () => {
  expect(usageStatus(row({}), SUBSCRIPTION, NOW)).toMatchObject({ tone: 'plain', stale: false, note: null });
});

test('a rejected account needs sign-in even while its last quota figures are kept', () => {
  const dead = row({
    origin: { kind: 'cli', place: 'Codex CLI' },
    failure: { _tag: 'missing-scope', scope: 'user:profile' } as AccountQuotaRow['failure'],
    failedAt: NOW,
  });
  expect(usageNeed(dead, SUBSCRIPTION)).toBe('sign-in');
  expect(usageNeed(row({ ...dead, quota: readAt(NOW) }), SUBSCRIPTION)).toBe('sign-in');
  expect(usageNeed(row({ failure: { _tag: 'stale-token' } as AccountQuotaRow['failure'] }), SUBSCRIPTION)).toBe('sign-in');
  expect(usageNeed(row({ failure: { _tag: 'unsupported' } as AccountQuotaRow['failure'] }), SUBSCRIPTION)).toBeNull();
});

test('a refusal carries how long it stands, measured from when it was recorded', () => {
  const limited = usageStatus(
    row({
      failedAt: NOW - MINUTE,
      failure: { _tag: 'rate-limited', retryAfterMs: 15 * MINUTE } as AccountQuotaRow['failure'],
    }),
    SUBSCRIPTION,
    NOW,
  );
  expect(limited.word).toBe('Rate limited · 14m');
  expect(limited.tone).toBe('alarm');
});

test('a provider that reports no usage is not a fault of the account', () => {
  const kimi = usageStatus(
    row({ provider: 'kimi-oauth', failure: { _tag: 'unsupported' } as AccountQuotaRow['failure'], failedAt: NOW }),
    SUBSCRIPTION,
    NOW,
  );
  expect(kimi.word).toBe('No usage reported');
  expect(kimi.tone).toBe('plain');
  expect(kimi.note).toContain('reports no usage');
});

test('a failed read keeps the windows it had, marked and dated', () => {
  const failed = usageStatus(
    row({
      quota: readAt(NOW),
      failure: { _tag: 'server', status: 503 } as AccountQuotaRow['failure'],
      failedAt: NOW,
    }),
    SUBSCRIPTION,
    NOW,
  );
  expect(failed.word).toBeNull();
  expect(failed.stale).toBe(true);
  expect(failed.note).toBe('the provider answered 503 · updated just now');
});

test('the age beside figures is the figures’ own, never the age of the attempt that failed', () => {
  const failed = usageStatus(
    row({
      quota: readAt(NOW - 3 * HOUR),
      failure: { _tag: 'transport' } as AccountQuotaRow['failure'],
      failedAt: NOW - MINUTE,
    }),
    SUBSCRIPTION,
    NOW,
  );
  expect(failed.note).toBe('the provider could not be reached · updated 3h ago');
});

test('figures nobody refreshed for two cadences are marked; fresher ones are not', () => {
  expect(usageStatus(row({ quota: readAt(NOW - 20 * MINUTE) }), SUBSCRIPTION, NOW).stale).toBe(false);

  const old = usageStatus(row({ quota: readAt(NOW - 45 * MINUTE) }), SUBSCRIPTION, NOW);
  expect(old.stale).toBe(true);
  expect(old.word).toBeNull();
});

test('figures kept from before a restart are marked and dated however young, until a reading replaces them', () => {
  const kept = usageStatus(row({ quota: readAt(NOW - MINUTE), restored: true }), SUBSCRIPTION, NOW);
  expect(kept.stale).toBe(true);
  expect(kept.word).toBeNull();
  expect(kept.note).not.toBeNull();

  expect(usageStatus(row({ quota: readAt(NOW - MINUTE), restored: false }), SUBSCRIPTION, NOW).stale).toBe(false);
});

test('a window the provider has already granted back is no longer the current reading', () => {
  const granted = usageStatus(
    row({
      quota: readAt(NOW - MINUTE, [new QuotaWindow({ kind: 'session', usedPercent: 95, resetsAt: (NOW - MINUTE) / 1000 })]),
    }),
    SUBSCRIPTION,
    NOW,
  );
  expect(granted.stale).toBe(true);
  expect(granted.word).toBeNull();

  const standing = usageStatus(
    row({ quota: readAt(NOW, [new QuotaWindow({ kind: 'session', usedPercent: 95, resetsAt: (NOW + HOUR) / 1000 })]) }),
    SUBSCRIPTION,
    NOW,
  );
  expect(standing.stale).toBe(false);
});
