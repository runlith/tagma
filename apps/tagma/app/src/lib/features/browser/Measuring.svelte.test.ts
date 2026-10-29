// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { WallClock } from '$lib/features/workspace/WallClock.svelte.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import { Door } from '$lib/wire/Door.js';
import Measuring from './Measuring.svelte';
import { pageOf } from './testing/page.js';

let app: TestApp | null = null;

afterEach(async () => {
  await app?.unmount();
  app = null;
});

test('a running trace and recording show who started them, and each act stops its own through the operator’s door', async () => {
  const asked: unknown[] = [];
  const page = pageOf('page-1');
  const at = new Date(Date.now() - 12_000).toISOString();
  app = mountShell(
    Layer.mergeAll(WallClock),
    Layer.mergeAll(
      Layer.of(Door, {
        perform: async (operation: string, input: unknown, lens: unknown) => void asked.push([operation, input, lens]),
      } as never),
      Layer.of(
        ThreadNames,
        new ThreadNames((thread) => (thread === 'builder' ? { label: 'Builder', archived: false, harness: false } : null)),
      ),
    ),
  );
  const target = app.draw(Measuring as never, {
    page: { ...page, live: { ...page.live, trace: { by: 'builder', at }, recording: { by: null, at } } },
  });
  const row = (measure: string) => target.querySelector<HTMLElement>(`[data-page-measure="${measure}"]`);

  expect(row('conditions')).toBeNull();
  expect(row('trace')?.textContent).toContain('Builder');
  expect(row('recording')).not.toBeNull();

  row('trace')!.querySelector('button')!.click();
  row('recording')!.querySelector('button')!.click();
  await waitUntil(() => asked.length === 2);
  expect(asked).toEqual([
    ['trace_page', { page: page.id, action: 'stop' }, { project: '1' }],
    ['record_page', { page: page.id, action: 'stop' }, { project: '1' }],
  ]);
});
