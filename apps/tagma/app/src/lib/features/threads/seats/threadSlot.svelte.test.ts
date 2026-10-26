// @vitest-environment jsdom
import type { WireThread } from '@tagma/server/threads/contract/wire/snapshot';
import { TestConnection } from '@runlith/chat-ui/testing/chatConnection';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import { makeStorage } from '@runlith/layer/testing';
import { stubFamily } from '@runlith/query/testing';
import { flush, waitFor, waitUntil } from '@runlith/testing/flush';
import { afterEach, expect, test } from 'vitest';

import { mountShell, testTagCatalog, type TestApp } from '$lib/app/testing.js';
import { feedSnapshot, slotWorld, testThreadChat } from '$lib/app/slotWorld.js';
import { testShelf } from '$lib/features/threads/native/testing.js';
import { SelectionRepo } from '$lib/features/graph/SelectionRepo.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import { AgentLibraryRepo } from '$lib/features/threads/library/AgentLibraryRepo.js';
import { DraftShelf } from '$lib/features/threads/native/DraftShelf.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import Fixture from './ThreadSlot.fixture.svelte';
import type { ThreadPaneSlot } from './threadSlot.svelte.js';
import { testArea, testKind, type TestArea } from '$lib/app/panes/testing.js';
import { THREAD_PANE, threadPaneId } from './pane.js';
import { ThreadSeats } from './ThreadSeats.svelte.js';

function areaOn(storage = makeStorage()): TestArea & { readonly seats: ThreadSeats } {
  const area = testArea([testKind(THREAD_PANE)], storage);
  area.panes.showSection('chat');
  return { ...area, seats: new ThreadSeats(area.panes) };
}

let app: TestApp | undefined;
const scope = Scope.make();

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a thread of another project opened beside is fed and answered through its own project, and a reload keeps its home', async () => {
  const here = new TestConnection<WireThread>();
  const home = new TestConnection<WireThread>();
  const chats = { here: testThreadChat(here), home: testThreadChat(home) };
  const storage = makeStorage();

  areaOn(storage).panes.open({ kind: THREAD_PANE, id: threadPaneId({ home: 2, threadId: 't9' }) });
  const reloaded = areaOn(storage);
  const pane = reloaded.panes.panes[0];
  if (pane === undefined) throw new Error('The pane was not restored.');

  const { layer } = slotWorld({ chats: { of: (projectId) => (projectId === 2 ? chats.home : chats.here) } }, scope);
  app = mountShell(
    Layer.mergeAll(
      layer,
      Layer.of(DraftShelf, testShelf()),
      Layer.of(SelectionRepo, { search: stubFamily() } as never),
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(AgentLibraryRepo, { skills: stubFamily() } as never),
    ),
    Layer.mergeAll(),
    { at: { projectId: 1, branch: null } },
  );
  let slot: ThreadPaneSlot | undefined;
  app.draw(Fixture as never, { ...reloaded, onSlot: (opened: ThreadPaneSlot) => (slot = opened) });
  await flush();
  const host = slot?.host;
  if (host === undefined) throw new Error('The pane started no slot.');

  expect([slot?.home, host.projectId, host.activeId]).toEqual([2, 2, 't9']);
  expect(app.app.hasScope(ProjectRung, { projectId: 2 })).toBe(true);
  await waitFor(() => expect(home.feeds.map((feed) => feed.threadId)).toEqual(['t9']));
  expect(here.feeds).toEqual([]);

  home.emit(feedSnapshot({ id: 't9' }), 't9');
  host.draft.setText('an answer');
  await waitUntil(() => host.canSend);
  await host.writes.send();

  expect(home.called('send').map((call) => call.threadId)).toEqual(['t9']);
  expect(here.calls).toEqual([]);
});

test('a pane of another project lets its thread go when it moves to another one, and its project when it closes', async () => {
  const home = new TestConnection<WireThread>();
  const chats = { here: testThreadChat(), home: testThreadChat(home) };
  const area = areaOn();
  const { panes, seats } = area;
  const opened = panes.open({ kind: THREAD_PANE, id: threadPaneId({ home: 2, threadId: 't9' }) });
  if (opened.kind === 'refused') throw new Error('No pane opened.');
  const key = opened.key;

  const { layer } = slotWorld({ chats: { of: (projectId) => (projectId === 2 ? chats.home : chats.here) } }, scope);
  app = mountShell(
    Layer.mergeAll(
      layer,
      Layer.of(DraftShelf, testShelf()),
      Layer.of(SelectionRepo, { search: stubFamily() } as never),
      Layer.of(TagCatalog, testTagCatalog()),
      Layer.of(AgentLibraryRepo, { skills: stubFamily() } as never),
    ),
    Layer.mergeAll(),
    { at: { projectId: 1, branch: null } },
  );
  app.draw(Fixture as never, { ...area, onSlot: () => undefined });
  const fed = (): string[] => home.feeds.filter((feed) => feed.open).map((feed) => feed.threadId);
  await waitFor(() => expect(fed()).toEqual(['t9']));

  seats.writerOf(key).navigate('t10');
  await waitFor(() => expect(fed()).toEqual(['t10']));
  expect(panes.panes.map((pane) => pane.id)).toEqual(['2:t10']);
  expect(app.app.hasScope(ProjectRung, { projectId: 2 })).toBe(true);

  panes.close(key);
  await waitFor(() => expect(fed()).toEqual([]));
  await waitUntil(() => app?.app.hasScope(ProjectRung, { projectId: 2 }) === false);
});
