// @vitest-environment jsdom
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { waitFor } from '@runlith/testing/flush';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Layer } from '@runlith/layer/Layer';
import { stubMutation } from '@runlith/query/testing';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { AccountsRepo } from '$lib/features/providers/AccountsRepo.js';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { UsageAccounts } from './usage/Accounts.svelte.js';
import { testProviders } from './testing.js';
import { CountdownClock } from './accounts/CountdownClock.svelte.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import ProviderGroup from './Group.svelte';

const door = {
  begin: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  setDefault: vi.fn(),
  relabel: vi.fn(),
  remove: vi.fn(),
};

const table = $state({ rows: [] as readonly AccountQuotaRow[] });
const accounts = {
  get rows() {
    return table.rows;
  },
  known: true,
  get providers() {
    return [];
  },
  of: (provider: string) => table.rows.filter((row) => row.provider === provider),
} as unknown as UsageAccounts;

function account(key: string, label: string, fields: Partial<AccountQuotaRow> = {}): AccountQuotaRow {
  return {
    provider: 'subscription',
    account: key,
    label,
    origin: { kind: 'own' },
    default: false,
    quota: null,
    failure: null,
    restored: false,
    failedAt: null,
    problem: null,
    lent: [],
    ...fields,
  } as AccountQuotaRow;
}

let app: TestApp | undefined;

beforeEach(() => {
  table.rows = [];
  for (const call of Object.values(door)) call.mockReset();
});

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
});

async function draw(
  provider: string,
  props: {
    found?: readonly never[];
    lifetime?: { provider: string; promisedSeconds: number | null; buckets: []; priorMeasuredAt: null };
  } = {},
): Promise<HTMLElement> {
  app = mountShell(
    Layer.mergeAll(Notices, CountdownClock),
    Layer.mergeAll(
      Layer.of(UsageAccounts, accounts),
      testProviders(),
      Layer.of(Workspace, { contextProject: null } as never),
      Layer.of(AccountsRepo, {
        begin: stubMutation(door.begin),
        complete: stubMutation(door.complete),
        refresh: stubMutation(door.refresh),
        useByDefault: stubMutation(door.setDefault),
        relabel: stubMutation(door.relabel),
        remove: stubMutation(door.remove),
      } as never),
    ),
  );
  const host = app.draw(ProviderGroup as never, { provider, found: [], ...props });
  flushSync();
  return host;
}

function card(target: HTMLElement, label: string): HTMLElement {
  const named = [...target.querySelectorAll('span')].find((span) => span.textContent?.trim() === label);
  const found = named?.closest('[data-account-row]');
  if (!(found instanceof HTMLElement)) throw new Error(`No row for ${label}.`);
  return found;
}

test('removing an account waits for the answer to a question the frame asks', async () => {
  table.rows = [account('k1', 'first@runlith.dev', { default: true }), account('k2', 'second@runlith.dev')];
  door.remove.mockResolvedValue({ provider: 'subscription', removed: 'k2', default: 'k1' });

  const target = await draw('subscription');
  const trigger = card(target, 'second@runlith.dev').querySelector('button[aria-label="Account actions"]');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('No menu on second@runlith.dev.');
  trigger.click();
  flushSync();
  const remove = [...document.querySelectorAll('[role="menuitem"]')].find((entry) => entry.textContent?.trim() === 'Remove');
  if (!remove) throw new Error('No Remove in the menu.');
  remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  flushSync();

  expect(door.remove).not.toHaveBeenCalled();
  const stack = app!.dialogs.stack;
  expect(stack).toHaveLength(1);

  (stack[0]?.props as { onConfirm: () => void }).onConfirm();
  await waitFor(() => expect(door.remove).toHaveBeenCalledWith({ provider: 'subscription', account: 'k2' }, expect.anything()));

  trigger.click();
  flushSync();
});
