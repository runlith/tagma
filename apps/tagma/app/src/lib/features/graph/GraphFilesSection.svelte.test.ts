// @vitest-environment jsdom
import { ServedTags } from '@tagma/server/graph/contract/wire/tags/served';
import { Layer } from '@runlith/layer/Layer';
import { flush } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';

import { mountShell, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Live } from '$lib/wire/Live.js';
import GraphFilesSection from './GraphFilesSection.svelte';
import { RemoteRepo } from './RemoteRepo.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('an unreadable tag declaration is named with its reason and opens its node', async () => {
  const tags = testTagCatalog();
  app = mountShell(
    Layer.mergeAll(
      Layer.of(TagCatalog, tags),
      Layer.of(RemoteRepo, {} as never),
      Layer.of(Live, { hold: () => ({ unsubscribe: () => undefined }) } as never),
      Layer.of(Notices, {} as never),
    ),
  );

  const host = app.draw(GraphFilesSection as never, {
    catalog: { entriesOf: () => [] },
    scope: 'project',
    project: { id: 1, name: 'runlith', storage: 'team' } as never,
  });
  tags.table = new ServedTags({
    catalogs: [],
    installed: [],
    findings: [],
    tags: [],
    unreadable: [{ name: 'cafebabe', id: 'invoice', reason: 'The amount field is not a schema.' }],
    actions: {},
    fieldNames: {},
    forms: {},
    laws: {},
    revision: { format: 2, revision: 'test' },
  });
  await flush();

  const declarations = host.querySelector('[aria-label="Unreadable tag declarations"]');
  expect(declarations?.querySelector('a')?.getAttribute('href')).toBe('/runlith/b/cafebabe');
  expect(declarations?.textContent).toContain('The amount field is not a schema.');
});
