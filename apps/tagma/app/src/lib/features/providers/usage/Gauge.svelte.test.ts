// @vitest-environment jsdom
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { testProviders } from '../testing.js';
import { CountdownClock } from '../accounts/CountdownClock.svelte.js';
import UsageGauge from './Gauge.svelte';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;

function row(windows: readonly QuotaWindow[], fields: Partial<AccountQuotaRow> = {}, readAt = NOW): AccountQuotaRow {
  return {
    provider: 'subscription',
    account: 'k1',
    label: 'work@example.com',
    origin: { kind: 'own' },
    default: true,
    quota: new QuotaObservation({ observedAt: new Date(readAt), source: 'usage', windows }),
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    lent: [],
    ...fields,
  } as AccountQuotaRow;
}

let app: TestApp | undefined;

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
  vi.useRealTimers();
});

function draw(drawn: AccountQuotaRow): HTMLElement {
  vi.useFakeTimers({ now: NOW });
  app = mountShell(Layer.mergeAll(CountdownClock, testProviders()));
  const host = app.draw(UsageGauge as never, { provider: drawn.provider, row: drawn });
  flushSync();
  const gauge = host.querySelector('[data-gauge]');
  if (!(gauge instanceof HTMLElement)) throw new Error('No gauge drawn.');
  return gauge;
}

test('the gauge fills to the tightest window, a per-model one included, and wears that window’s pace', () => {
  const gauge = draw(
    row([
      new QuotaWindow({ kind: 'session', usedPercent: 36, windowMinutes: 300, resetsAt: (NOW + 2 * HOUR) / 1000 }),
      new QuotaWindow({
        kind: 'model',
        label: 'Fable',
        usedPercent: 50,
        windowMinutes: 10_080,
        resetsAt: (NOW + 6 * 24 * HOUR) / 1000,
      }),
    ]),
  );

  expect(gauge.dataset.fill).toBe('50');
  expect(gauge.dataset.tone).toBe('warning');
  expect(gauge.querySelector('[data-lit]')).not.toBeNull();
});

test('the crest lights the nearest number of fifths', () => {
  const gauge = draw(row([new QuotaWindow({ kind: 'session', usedPercent: 62, windowMinutes: 300, resetsAt: (NOW + 4 * HOUR) / 1000 })]));

  expect(gauge.querySelectorAll('[data-lit]')).toHaveLength(3);
});

test('figures nobody refreshed keep their fill and are marked stale; a row with none draws empty', () => {
  const stale = draw(row([new QuotaWindow({ kind: 'session', usedPercent: 13 })], {}, NOW - 45 * MINUTE));
  expect(stale.dataset.fill).toBe('13');
  expect(stale.hasAttribute('data-stale')).toBe(true);

  void app?.unmount();
  const empty = draw(row([], { quota: null }));
  expect(empty.dataset.fill).toBe('0');
  expect(empty.hasAttribute('data-stale')).toBe(false);
  expect(empty.querySelector('[data-lit]')).toBeNull();
});
