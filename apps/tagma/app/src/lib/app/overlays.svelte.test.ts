// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { Overlay } from '@runlith/primitives/Overlay.svelte';
import { flushSync } from 'svelte';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';
import NoticeCards from '$lib/app/chrome/NoticeCards.svelte';
import { Frame } from '$lib/app/chrome/FrameState.svelte.js';
import { Standing } from '$lib/app/chrome/Standing.svelte.js';
import { NoticesLayer } from '$lib/features/notices/layer.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { NoticeColumn } from '$lib/features/notices/overlay.js';
import { mountShell, type TestApp } from './testing.js';

let app: TestApp | undefined;

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
});

test('a notice puts the column on screen, and the last one dismissed takes it away', async () => {
  app = mountShell(
    Layer.mergeAll(
      NoticesLayer,
      Frame,
      NoticeColumn.present(NoticeCards),
      Layer.of(Standing, { newHost: null, offersNewHost: false } as never),
    ),
  );
  app.draw();
  const overlay = app.app.resolve(Overlay);
  const notices = app.app.resolve(Notices);
  expect(overlay.isOpen(NoticeColumn)).toBe(false);

  const id = notices.error('Request failed', 'the door answered nothing');
  flushSync();

  expect(overlay.isOpen(NoticeColumn)).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Request failed');

  notices.dismiss(id);

  await waitUntil(() => !overlay.isOpen(NoticeColumn));
});
