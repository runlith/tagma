// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { flushSync, tick } from 'svelte';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { QueryClient } from '@tanstack/query-core';
import { AccountKey } from '@runlith/llm/models/authStatus';
import type { AccountQuotaRow } from '@tagma/server/providers/contract/wire/accounts';
import { liveFeed, mountShell } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { Live } from '$lib/wire/Live.js';
import { loadOperations } from '$lib/wire/operation.js';
import { testDoor } from '$lib/wire/testing.js';
import { AccountsRepo } from './AccountsRepo.js';
import { AdaptersRepo } from './adapters/AdaptersRepo.js';
import { CountdownClock } from './accounts/CountdownClock.svelte.js';
import { UsageAccounts } from './usage/Accounts.svelte.js';
import { testProviders } from './testing.js';
import AuthPanel from './AuthPanel.svelte';

await loadOperations();

test('accounts outside the catalog remain visible for removal, without installed-provider actions', async () => {
  const feed = liveFeed();
  const removed = Promise.withResolvers<void>();
  let rows: readonly AccountQuotaRow[] = [
    {
      provider: 'removed-adapter',
      account: AccountKey.make('saved'),
      label: 'saved@example.org',
      origin: { kind: 'own' },
      default: false,
      quota: null,
      failure: null,
      restored: false,
      failedAt: null,
      problem: { kind: 'not-installed' },
    },
  ];
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const app = mountShell(
    Layer.mergeAll(Notices, CountdownClock, UsageAccounts, AccountsRepo, AdaptersRepo),
    Layer.mergeAll(
      testProviders([]),
      Layer.of(Cache, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      Layer.of(Live, feed.live),
      Layer.of(
        Door,
        testDoor(async (input, init) => {
          const request = new Request(input, init);
          switch (new URL(request.url).pathname) {
            case '/api/op/read_cache_lifetimes':
              return json({ status: 'read', lifetimes: [] });
            case '/api/op/list_console_keys':
              return json({ status: 'listed', providers: [] });
            case '/api/op/remove_account': {
              const { provider, account } = (await request.json()) as { provider: string; account: string };
              rows = rows.filter((row) => row.provider !== provider || row.account !== account);
              feed.routes.get('accounts.subscribe')!(rows);
              removed.resolve();
              return json({ status: 'removed', removed: { provider, removed: account, default: null } });
            }
            default:
              throw new Error(`Unexpected request ${request.url}`);
          }
        }),
      ),
    ),
  );
  try {
    const target = app.draw(AuthPanel as never);
    feed.routes.get('accounts.subscribe')!(rows);
    flushSync();
    const section = target.querySelector('section[aria-label="removed-adapter"]');
    expect(section?.textContent).toContain('saved@example.org');
    const actions = section!.querySelectorAll('button');
    expect(actions.length).toBe(1);
    actions[0]!.click();
    await removed.promise;
    await tick();
    expect(target.querySelector('section[aria-label="removed-adapter"]')).toBeNull();
  } finally {
    await app.unmount();
  }
});
