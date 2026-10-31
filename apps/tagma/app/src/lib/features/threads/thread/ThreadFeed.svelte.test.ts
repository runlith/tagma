// @vitest-environment jsdom

import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { Layer } from '@runlith/layer/Layer';
import { stubFamily } from '@runlith/query/testing';
import { SettingsRepo } from '$lib/features/settings/SettingsRepo.js';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { afterEach, expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { feedSnapshot, testThreadChat } from '$lib/app/slotWorld.js';
import { Door } from '$lib/wire/Door.js';
import { testDoor } from '$lib/wire/testing.js';
import { ThreadChats } from '../ThreadChats.js';
import { SurfaceChoices } from '../external/Surface.svelte.js';
import { ThreadRung } from '$lib/features/workspace/ThreadRung.js';
import { ProductRecords } from '../native/records.js';
import { testRecords } from '../native/testing.js';
import { ThreadEffects } from './ThreadEffects.js';
import { ThreadFeed } from './ThreadFeed.svelte.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function mount(port: TestConnection<WireThread>): TestApp {
  const chat = testThreadChat(port);
  app = mountShell(
    Layer.mergeAll(
      ThreadEffects,
      ThreadFeed,
      Layer.of(ThreadChats, { of: () => chat } as never),
      Layer.of(SettingsRepo, { catalog: stubFamily() } as never),
      SurfaceChoices,
      Layer.of(Door, testDoor()),
      Layer.of(ProductRecords, testRecords()),
    ),
  );
  return app;
}

test('two holders of one thread share one session and one subscription', () => {
  const port = new TestConnection<WireThread>();
  const tagma = mount(port);

  const first = tagma.app.hold(ThreadRung, { id: 'thread-1' });
  const second = tagma.app.hold(ThreadRung, { id: 'thread-1' });

  expect(tagma.app.resolve(ThreadFeed, first.scope)).toBe(tagma.app.resolve(ThreadFeed, second.scope));
  expect(port.feeds).toHaveLength(1);
});

test('the last holder leaving shelves the session and a later hold resumes from its cursor', async () => {
  const port = new TestConnection<WireThread>();
  const tagma = mount(port);

  const held = tagma.app.hold(ThreadRung, { id: 'thread-1' });
  tagma.app.resolve(ThreadFeed, held.scope);
  await waitUntil(() => port.feeds.length === 1);
  port.emit(feedSnapshot({ id: 'thread-1' }, null, undefined, 7), 'thread-1');
  await waitUntil(() => tagma.app.resolve(ThreadFeed, held.scope).session.status === 'ready');

  held.release();
  await waitUntil(() => port.open === 0);

  const again = tagma.app.hold(ThreadRung, { id: 'thread-1' });
  tagma.app.resolve(ThreadFeed, again.scope);
  await waitUntil(() => port.feeds.length === 2);
  expect(port.feeds[1]?.from).toEqual({ position: 0, seq: 7 });
});
