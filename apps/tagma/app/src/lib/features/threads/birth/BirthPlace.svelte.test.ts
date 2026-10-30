// @vitest-environment jsdom

import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import type { WorktreePlace } from '@tagma/server/worktrees/contract/wire/rows';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { Scope } from '@runlith/layer/Scope';
import { stubMutation } from '@runlith/query/testing';
import { waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test, vi } from 'vitest';
import { commitRoute, feedSnapshot, testThreadChat, testThreadSlot } from '$lib/app/slotWorld.js';
import { testPlaces } from '$lib/app/testing.js';
import type { ThreadSlot } from '../ThreadSlot.svelte.js';

const main = { rootId: 'root-main', kind: 'main', name: 'tagma', branch: 'main', missing: false, hue: null } as WorktreePlace;
const sidebar = {
  rootId: 'root-sidebar',
  kind: 'tagma',
  name: 'sidebar',
  branch: 'tagma/sidebar',
  missing: false,
  hue: 2,
} as WorktreePlace;

const create = vi.fn();
let life: Scope | null = null;

function open(): { host: ThreadSlot; port: TestConnection<WireThread> } {
  life = Scope.make();
  const port = new TestConnection<WireThread>();
  const places = {
    ...testPlaces(),
    known: true,
    rows: [main, sidebar],
    targets: [main, sidebar],
    main,
    aimed: sidebar,
    byRoot: (rootId: string) => [main, sidebar].find((row) => row.rootId === rootId) ?? null,
    placeOf: (threadId: string) => (threadId === 'in-sidebar' ? sidebar : main),
  };
  const host = testThreadSlot(
    { projectId: 47, chat: testThreadChat(port), places: places as never, threads: { create: stubMutation(create) } },
    {},
    life,
  );
  return { host, port };
}

async function send(host: ThreadSlot, text: string): Promise<Record<string, unknown>> {
  create.mockResolvedValueOnce({ snapshot: { thread: { id: `born-${create.mock.calls.length}` } } });
  host.draft.setText(text);
  await host.writes.send();
  return create.mock.calls.at(-1)?.[0].payload as Record<string, unknown>;
}

afterEach(async () => {
  await life?.close();
  life = null;
  create.mockReset();
});

test('a new draft is born in the main checkout while the frame stands in a worktree and its last draft was placed there', async () => {
  const { host } = open();
  host.startDraft({ kind: 'worktree', rootId: sidebar.rootId });
  commitRoute(host);

  host.startDraft();
  commitRoute(host);

  expect(host.place).toBe(main);
  expect((await send(host, 'fix the typo on main')).worktree).toBeUndefined();
});

test('a place the draft was given stands while another thread is opened and the draft is returned to, until its send', async () => {
  const { host, port } = open();
  host.startDraft();
  commitRoute(host);
  host.birth.place.pick({ kind: 'worktree', rootId: sidebar.rootId });

  host.open('in-sidebar');
  commitRoute(host);
  port.emit(feedSnapshot({ id: 'in-sidebar' }), 'in-sidebar');
  await waitUntil(() => host.chat.session?.thread?.id === 'in-sidebar');
  host.activateRoute(null, 47);

  expect(host.place).toBe(sidebar);
  expect((await send(host, 'carry on in the sidebar')).worktree).toBe(sidebar.rootId);
  expect(host.birth.place.chosen).toEqual({ kind: 'main' });
});
