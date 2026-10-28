// @vitest-environment jsdom
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

import { Layer } from '@runlith/layer/Layer';
import { stubMutation, stubSingle } from '@runlith/query/testing';
import { ThreadOnScreen } from '$lib/features/threads/OnScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { UsageAccounts } from '$lib/features/providers/usage/Accounts.svelte.js';
import { ProviderCatalog } from '$lib/features/providers/Catalog.svelte.js';
import { testProviderCatalog } from '$lib/features/providers/testing.js';

const SHIPPED = testProviderCatalog();
import { CountdownClock } from '$lib/features/providers/accounts/CountdownClock.svelte.js';
import UsageMeters from './UsageMeters.svelte';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const HOUR = 3_600_000;

function account(provider: string, key: string, usedPercent: number, hours: number): AccountQuotaRow {
  return {
    provider,
    account: key,
    label: `${key}@runlith.dev`,
    origin: { kind: 'own' },
    default: true,
    quota: new QuotaObservation({
      observedAt: new Date(NOW),
      source: 'usage',
      windows: [new QuotaWindow({ kind: 'session', usedPercent, resetsAt: (NOW + hours * HOUR) / 1000 })],
    }),
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
  } as AccountQuotaRow;
}

function unread(provider: string, failure: AccountQuotaRow['failure']): AccountQuotaRow {
  return {
    provider,
    account: 'k1',
    label: 'k1@runlith.dev',
    origin: { kind: 'own' },
    default: true,
    quota: null,
    failure,
    failedAt: NOW,
    problem: null,
  } as AccountQuotaRow;
}

let mountPoint: HTMLElement | undefined;
let app: TestApp | undefined;

function table(rows: readonly AccountQuotaRow[]): UsageAccounts {
  return {
    rows,
    known: true,
    providers: rows.map((row) => ({ provider: row.provider, served: SHIPPED.provider(row.provider), rows: [row], standing: row })),
    of: (provider: string) => rows.filter((row) => row.provider === provider),
  } as unknown as UsageAccounts;
}

afterEach(async () => {
  if (app) void app.unmount();
  app = undefined;
  mountPoint = undefined;
  vi.useRealTimers();
});

function segments(): string[] {
  flushSync();
  return [...(mountPoint?.querySelectorAll('[data-usage-segment]') ?? [])].map((entry) => entry.getAttribute('data-usage-segment') ?? '');
}

function gauge(provider: string): HTMLElement {
  const found = mountPoint?.querySelector(`[data-usage-segment="${provider}"] [data-gauge]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No gauge for ${provider}.`);
  return found;
}

function drawSegments(rows: readonly AccountQuotaRow[]): void {
  vi.useFakeTimers({ now: NOW });
  app = mountShell(
    Layer.mergeAll(CountdownClock, Notices),
    Layer.mergeAll(
      Layer.of(ThreadOnScreen, {
        host: { modelSettings: null, activeThread: null, applyAccount: vi.fn() },
      } as never),
      Layer.of(UsageAccounts, table(rows)),
      Layer.of(ProviderCatalog, SHIPPED),
      Layer.of(AccountsRepo, {
        refresh: stubMutation(),
        useByDefault: stubMutation(),
      } as never),
    ),
  );
  mountPoint = app.draw(UsageMeters as never);
  flushSync();
}

test('each provider holding an account stands as a segment, its gauge filled to its tightest window', () => {
  drawSegments([account('subscription', 'a1', 85, 2), account('openai-oauth', 'o1', 14, 30)]);

  expect(segments()).toEqual(['subscription', 'openai-oauth']);
  expect(gauge('subscription').dataset.fill).toBe('85');
  expect(gauge('openai-oauth').dataset.fill).toBe('14');
});

test('a provider with nothing to measure takes no room, while one whose credential died stands and asks', () => {
  drawSegments([
    account('subscription', 'a1', 40, 2),
    unread('example-oauth', { _tag: 'unsupported' } as AccountQuotaRow['failure']),
    unread('acme-oauth', { _tag: 'stale-token' } as AccountQuotaRow['failure']),
  ]);

  expect(segments()).toEqual(['subscription', 'acme-oauth']);
  expect(gauge('acme-oauth').dataset.fill).toBe('0');
});

test('the tenant draws nothing until the table names a provider', () => {
  drawSegments([]);

  expect(mountPoint?.querySelector('[data-usage-meters]')).toBeNull();
});
