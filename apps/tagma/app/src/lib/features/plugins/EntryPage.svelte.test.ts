// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { QueryClient } from '@tanstack/query-core';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { EntryRow, MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';
import type { PluginPreview, PluginRow } from '@tagma/server/plugins/contract/wire/rows';
import { mountShell } from '$lib/app/testing.js';
import { McpRepo } from '$lib/features/mcp/Repo.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { PluginsRepo } from './Repo.js';
import EntryPage from './EntryPage.svelte';

await loadCatalog();

const marketplace: MarketplaceRow = {
  id: 'fixture',
  title: 'Fixture',
  description: null,
  owner: null,
  label: 'unreviewed',
  source: { kind: 'git', url: 'https://example.com/acme/fixture.git' },
  format: 'claude-code',
  revision: { commit: 'a'.repeat(40), fetched: '2026-10-29T10:00:00.000Z' },
  failure: null,
  entries: 1,
};

const entry: EntryRow = {
  marketplace: 'fixture',
  name: 'greeter',
  plugin: 'greeter',
  title: 'Greeter',
  description: 'Greets.',
  version: '1.0.0',
  author: 'Acme',
  homepage: null,
  repository: null,
  category: null,
  brings: ['skill'],
  source: './plugins/greeter',
  policy: null,
  state: 'available',
};

const source = { kind: 'git' as const, url: 'https://example.com/acme/fixture.git', path: 'plugins/greeter' };

const preview: PluginPreview = {
  prepared: 'held-1',
  expires: '2999-01-01T00:00:00.000Z',
  id: 'greeter',
  title: 'Greeter',
  version: '1.0.0',
  description: 'Greets.',
  format: 'claude-code',
  about: { author: 'Acme', homepage: null, repository: null, license: null },
  source,
  origin: { marketplace: 'fixture', entry: 'greeter' },
  replaces: false,
  components: [{ kind: 'skill', name: 'greeter-hello' }],
  ignored: [],
  options: [],
  consent: { runs: [], reaches: [], raises: [] },
};

const plugin: PluginRow = {
  id: 'greeter',
  title: 'Greeter',
  version: '1.0.0',
  description: 'Greets.',
  format: 'claude-code',
  source,
  origin: { marketplace: 'fixture', entry: 'greeter' },
  root: '/data/agent-plugins/greeter',
  enabled: true,
  everywhere: false,
  components: [{ kind: 'skill', name: 'greeter-hello' }],
  ignored: [],
  options: [],
  outdated: false,
};

test('a plugin page previews its entry, and adding sends the prepared revision for this project', async () => {
  const asked: { readonly path: string; readonly body: unknown }[] = [];
  const installed = Promise.withResolvers<void>();
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const app = mountShell(
    Layer.mergeAll(Notices, PluginsRepo, McpRepo),
    Layer.mergeAll(
      Layer.of(Cache, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      Layer.of(ThreadSeats, { ask: () => undefined } as never),
      Layer.of(
        Door,
        testDoor(async (input, init) => {
          const request = new Request(input, init);
          const path = new URL(request.url).pathname;
          asked.push({ path, body: await request.json() });
          switch (path) {
            case '/api/op/preview_plugin':
              return json({ status: 'ok', entry, preview });
            case '/api/op/install_plugin':
              installed.resolve();
              return json({ status: 'ok', plugin });
            default:
              throw new Error(`Unexpected request ${request.url}`);
          }
        }),
      ),
    ),
  );
  try {
    const target = app.draw(EntryPage as never, {
      listing: { entry, marketplace, also: [] },
      project: { id: 1, name: 'demo' } as Project,
      plugins: [],
      servers: [],
      hrefOf: () => '',
      onadded: async () => undefined,
    });
    flushSync();
    await expect.poll(() => target.textContent).toContain('The skill $greeter-hello');
    [...target.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Add to demo')!.click();
    await installed.promise;
    expect(asked).toEqual([
      { path: '/api/op/preview_plugin', body: { marketplace: 'fixture', entry: 'greeter' } },
      { path: '/api/op/install_plugin', body: { prepared: 'held-1', scope: 'project' } },
    ]);
  } finally {
    await app.unmount();
  }
});
