// @vitest-environment jsdom
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Layer } from '@runlith/layer/Layer';
import { stubMutation, stubQuery } from '@runlith/query/testing';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { UsageAccounts } from './Accounts.svelte.js';
import { ProviderCatalog } from '../Catalog.svelte.js';
import { testProviderCatalog } from '../testing.js';
import { CountdownClock } from '../accounts/CountdownClock.svelte.js';
import UsagePopover from './Popover.svelte';

const door = {
  discover: vi.fn(),
  refresh: vi.fn(),
  setDefault: vi.fn(),
};

const catalog = testProviderCatalog();
const table = $state({ rows: [] as readonly AccountQuotaRow[] });
const accounts = {
  get rows() {
    return table.rows;
  },
  get known() {
    return table.rows.length > 0;
  },
  get providers() {
    return [...new Set(table.rows.map((row) => row.provider))].map((provider) => {
      const rows = table.rows
        .filter((row) => row.provider === provider)
        .sort((left, right) => Number(right.default) - Number(left.default) || left.label.localeCompare(right.label));
      return { provider, served: catalog.provider(provider), rows, standing: rows[0] as AccountQuotaRow };
    });
  },
  of: (provider: string) =>
    table.rows
      .filter((row) => row.provider === provider)
      .sort((left, right) => Number(right.default) - Number(left.default) || left.label.localeCompare(right.label)),
} as unknown as UsageAccounts;

const NOW = Date.now();
const HOUR = 3_600_000;

function account(key: string, label: string, fields: Partial<AccountQuotaRow> = {}, readAt = NOW): AccountQuotaRow {
  return {
    provider: 'subscription',
    account: key,
    label,
    origin: { kind: 'own' },
    default: false,
    quota: reading([new QuotaWindow({ kind: 'session', usedPercent: 13 })], readAt),
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    ...fields,
  } as AccountQuotaRow;
}

function reading(windows: readonly QuotaWindow[], readAt = NOW): QuotaObservation {
  return new QuotaObservation({ observedAt: new Date(readAt), source: 'usage', windows });
}

function weekly(usedPercent: number): QuotaObservation {
  return reading([new QuotaWindow({ kind: 'weekly', usedPercent, resetsAt: (NOW + 5 * 24 * HOUR) / 1000 })]);
}

let app: TestApp | undefined;

beforeEach(() => {
  table.rows = [];
  for (const call of Object.values(door)) call.mockReset();
  door.discover.mockResolvedValue({ logins: [], unreadable: [] });
});

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

async function open(
  thread: { provider: string; account: string | null; pinned: boolean } | null = null,
  useInThread: ((account: string) => Promise<void>) | null = null,
  followDefault: (() => Promise<void>) | null = null,
): Promise<HTMLElement> {
  app = mountShell(
    Layer.mergeAll(CountdownClock, Notices),
    Layer.mergeAll(
      Layer.of(UsageAccounts, accounts),
      Layer.of(ProviderCatalog, catalog),
      Layer.of(AccountsRepo, {
        cacheLifetime: { ...stubQuery(), refresh: vi.fn().mockResolvedValue([]) },
        begin: stubMutation(vi.fn(() => new Promise(() => undefined))),
        complete: stubMutation(),
        refresh: stubMutation(door.refresh),
        useByDefault: stubMutation(door.setDefault),
      } as never),
    ),
  );
  const host = app.draw(UsagePopover as never, { thread, useInThread, followDefault });
  flushSync();
  trigger = host.querySelector('button');
  return reopen();
}

let trigger: HTMLButtonElement | null = null;

async function reopen(): Promise<HTMLElement> {
  trigger?.click();
  flushSync();
  await vi.waitFor(() => expect(document.querySelector('[data-roster-row]')).not.toBeNull());
  flushSync();
  return document.body;
}

function rows(target: HTMLElement): string[] {
  return [...target.querySelectorAll('[data-roster-row]')].map((entry) => entry.getAttribute('data-roster-row') ?? '');
}

function press(target: Element | null, selector: string): void {
  const found = target?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`Nothing matches ${selector}.`);
  found.click();
  flushSync();
}

function drill(target: HTMLElement, provider: string): HTMLElement {
  press(target, `[data-roster-row="${provider}"]`);
  const found = target.querySelector(`[data-provider-detail="${provider}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`No detail opened for ${provider}.`);
  return found;
}

test('the roster lists one row per provider, the fullest allowance first', async () => {
  table.rows = [
    account('k1', 'first@runlith.dev', { default: true }),
    account('o1', 'codex@runlith.dev', { provider: 'openai-oauth', default: true, quota: weekly(85) }),
    account('x1', 'grok@runlith.dev', { provider: 'xai-oauth', default: true, quota: weekly(50) }),
  ];

  const target = await open();

  expect(rows(target)).toEqual(['openai-oauth', 'xai-oauth', 'subscription']);
});

test('the default moves through the door, not the thread’s pin', async () => {
  const thread = vi.fn().mockResolvedValue(undefined);
  table.rows = [account('k1', 'first@runlith.dev', { default: true }), account('k2', 'second@runlith.dev')];
  door.setDefault.mockResolvedValue([]);

  const target = await open({ provider: 'subscription', account: 'k2', pinned: true }, thread);
  const detail = drill(target, 'subscription');

  press(detail, '[data-switch-row="k2"]');
  await vi.waitFor(() => expect(door.setDefault).toHaveBeenCalledWith({ provider: 'subscription', account: 'k2' }, expect.anything()));
  expect(thread).not.toHaveBeenCalled();
});

test('the thread’s pin and the way back are offered in the thread’s provider alone', async () => {
  const thread = vi.fn().mockResolvedValue(undefined);
  const follow = vi.fn().mockResolvedValue(undefined);
  table.rows = [
    account('k1', 'first@runlith.dev', { default: true }),
    account('k2', 'second@runlith.dev'),
    account('o1', 'codex@runlith.dev', { provider: 'openai-oauth', default: true }),
  ];

  const target = await open({ provider: 'subscription', account: 'k2', pinned: true }, thread, follow);
  const detail = drill(target, 'subscription');

  expect(detail.querySelector('[data-pin-row="k2"]')).toBeNull();
  press(detail, '[data-pin-row="k1"]');
  await vi.waitFor(() => expect(thread).toHaveBeenCalledWith('k1'));
  expect(door.setDefault).not.toHaveBeenCalled();

  press(drill(await reopen(), 'subscription'), '[data-thread-strip]');
  await vi.waitFor(() => expect(follow).toHaveBeenCalled());

  const other = drill(await reopen(), 'openai-oauth');
  expect(other.querySelector('[data-pin-row]')).toBeNull();
  expect(other.querySelector('[data-thread-strip]')).toBeNull();
});
