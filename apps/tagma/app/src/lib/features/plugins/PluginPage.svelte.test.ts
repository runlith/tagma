// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { flushSync } from 'svelte';
import { Layer } from '@runlith/layer/Layer';
import { Cache } from '@runlith/query/repo';
import { QueryClient } from '@tanstack/query-core';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { PluginRow } from '@tagma/server/plugins/contract/wire/rows';
import { mountShell } from '$lib/app/testing.js';
import { SecretsRepo } from '$lib/features/secrets/Repo.js';
import { Asking } from '$lib/features/threads/Asking.js';
import { Door } from '$lib/wire/Door.js';
import { loadCatalog, testDoor } from '$lib/wire/testing.js';
import { CardParts } from './parts.js';
import { PluginsRepo } from './Repo.js';
import PluginPage from './PluginPage.svelte';

await loadCatalog();

const anthropic: PluginRow = {
  id: 'anthropic',
  title: 'Anthropic',
  version: null,
  description: null,
  builtin: true,
  format: null,
  source: null,
  root: null,
  enabled: true,
  everywhere: true,
  off: false,
  providers: { models: true, harnesses: true, speech: false },
  components: [],
  ignored: [],
  options: [],
  outdated: false,
  faults: [],
};

test('a built-in plugin’s card offers only the machine switch, and turning it off everywhere switches it off on the machine', async () => {
  const switched = Promise.withResolvers<unknown>();
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const app = mountShell(
    Layer.mergeAll(PluginsRepo, SecretsRepo, CardParts),
    Layer.mergeAll(
      Layer.of(Cache, new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      Layer.of(Asking, {} as never),
      Layer.of(
        Door,
        testDoor(async (input, init) => {
          const request = new Request(input, init);
          if (new URL(request.url).pathname !== '/api/op/enable_plugin') throw new Error(`Unexpected request ${request.url}`);
          switched.resolve(await request.json());
          return json({ status: 'ok', plugin: { ...anthropic, off: true } });
        }),
      ),
    ),
  );
  try {
    const target = app.draw(PluginPage as never, {
      item: { kind: 'plugin', key: 'plugin/anthropic', title: 'Anthropic', row: anthropic, servers: [], state: 'ok', newer: null },
      project: { id: 1, name: 'demo' } as Project,
      catalog: null,
      onchanged: async () => undefined,
      onremoved: () => undefined,
    });
    flushSync();
    const buttons = [...target.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Turn off everywhere']);
    buttons[0]!.click();
    expect(await switched.promise).toEqual({ id: 'anthropic', enabled: false, scope: 'machine' });
  } finally {
    await app.unmount();
  }
});
