// @vitest-environment jsdom
import type { ThreadChangesFrame } from '@tagma/server/change-record/contract/wire/threadChanges';
import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { besideOf } from '$lib/app/opening/beside.js';
import { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import { liveFeed, mountShell, screen, testLinks, type TestApp } from '$lib/app/testing.js';
import { Beside } from '$lib/features/opening/Beside.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import { threadHolder } from '$lib/shared/panes/holder.js';
import { Live } from '$lib/wire/Live.js';
import ChangesCount from './ChangesCount.svelte';
import { CHANGES_PANE, changesPane } from './paneContent.js';
import { ThreadChanges } from './ThreadChanges.svelte.js';

const frame = (paths: number, uncommitted = { added: 0, removed: 0 }): ThreadChangesFrame => ({
  kind: 'whole',
  threadId: 'thread-1',
  held: { paths, unproven: 0 },
  uncommitted,
  checkouts: [
    {
      checkout: 'root-1' as RootId,
      projectId: 1,
      root: '/repo',
      branch: 'main',
      revision: 1,
      state: { kind: 'current' },
      uncommitted,
      entries:
        paths === 0
          ? []
          : [
              {
                section: 'uncommitted',
                path: 'src/a.ts',
                from: null,
                git: 'modified',
                lines: { added: 3, removed: 1 },
                writing: false,
                others: [],
                nobody: false,
              },
            ],
    },
  ],
  commits: [],
  moreCommits: false,
  ends: [],
});

let app: TestApp | undefined;

afterEach(() => {
  if (app) void app.unmount();
  app = undefined;
});

function draw(first: ThreadChangesFrame) {
  const area = testArea([testKind(CHANGES_PANE)]);
  const seats = new ThreadSeats(area.panes);
  const opening = new Opening(testLinks(), {} as never, {} as never, { refusal: () => undefined } as never, new Host('desktop', 'macos'));
  const feed = liveFeed();
  app = mountShell(
    Layer.mergeAll(
      screen(),
      Layer.of(Opening, opening),
      Layer.of(SidePanes, area.panes),
      Layer.of(ThreadSeats, seats),
      Layer.of(Beside, besideOf(area.panes, seats)),
      ThreadChanges,
    ),
    Layer.mergeAll(Layer.of(Live, feed.live)),
    { thread: { id: 'thread-1' } },
  );
  area.panes.seatMain({ projectId: 1, activeId: 'thread-1' });
  const page = app.draw(ChangesCount as never);
  const send = (next: ThreadChangesFrame): void => {
    feed.routes.get('thread.changes')?.(next);
    flushSync();
  };
  send(first);
  return { area, send, count: () => page.querySelector<HTMLElement>('[data-thread-changes-count]') };
}

test('the count carries the frame’s sum while the Changes tab is off screen, opens that tab, and yields to it', () => {
  const { area, send, count } = draw(frame(1, { added: 7, removed: 2 }));
  expect(count()?.textContent).toContain('+7');
  expect(count()?.textContent).toContain('−2');

  count()?.click();
  flushSync();
  expect(area.panes.shows(changesPane)).toBe(true);
  expect(area.layouts.layout(threadHolder('thread-1')).tabs.map((tab) => tab.kind)).toEqual([CHANGES_PANE]);
  expect(count()).toBeNull();

  area.panes.showArea(false);
  send(frame(2));
  expect(count()).not.toBeNull();
  expect(count()?.textContent).not.toContain('+');
});

test('a thread with no changes shows no count', () => {
  const { count } = draw(frame(0));
  expect(count()).toBeNull();
});
