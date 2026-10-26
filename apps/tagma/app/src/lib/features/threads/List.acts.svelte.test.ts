// @vitest-environment jsdom

import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { afterEach, expect, test, vi } from 'vitest';

import { liveFeed, mountShell, threadsRepo, type TestApp } from '$lib/app/testing.js';
import { ExecutionsRepo } from '$lib/features/executions/Repo.js';
import { ThreadsRepo } from './Repo.js';
import { Live } from '$lib/wire/Live.js';
import { ThreadList } from './List.svelte.js';
import { FolderActs } from './FolderActs.js';
import { ThreadOnScreen } from './OnScreen.svelte.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Refusal } from '$lib/wire/refusal.js';

let app: TestApp | undefined;
const feed = liveFeed();
const removed = vi.fn();
const titled = vi.fn();
const reported: unknown[] = [];

function open(): ThreadList {
  app = mountShell(
    Layer.mergeAll(ThreadList, FolderActs, Notices),
    Layer.mergeAll(
      Layer.of(
        ThreadsRepo,
        threadsRepo({
          remove: { run: (input: unknown) => removed(input) },
          generateTitle: { run: (input: unknown) => titled(input) },
        }),
      ),
      Layer.of(Live, feed.live),
      Layer.of(ThreadOnScreen, { page: null, host: null, shown: [] } as never),
      Layer.of(ExecutionsRepo, {} as never),
      Layer.of(Failure, new Failure((reason) => void reported.push(reason))),
    ),
  );
  return app.app.resolve(ThreadList);
}

afterEach(async () => {
  if (app) await app.unmount();
  app = undefined;
  feed.frame = null;
  removed.mockReset();
  titled.mockReset();
  reported.length = 0;
});

test('a naming reaches the door while another thread is still being named', async () => {
  const list = open();
  titled.mockImplementation((input: { id: string }) =>
    input.id === 'thread-slow' ? new Promise(() => undefined) : Promise.resolve({ outcome: 'named', title: 'Named' }),
  );

  void list.generateTitle('thread-slow');
  expect(list.busy('thread-slow', 'title')).toBe(true);
  expect(list.busy('thread-other', 'title')).toBe(false);

  await list.generateTitle('thread-other');

  expect(titled).toHaveBeenCalledTimes(2);
  expect(list.busy('thread-other', 'title')).toBe(false);
  expect(list.busy('thread-slow', 'title')).toBe(true);
});

test('a second naming of the same thread is refused while the first is going', async () => {
  const list = open();
  titled.mockReturnValue(new Promise(() => undefined));

  void list.generateTitle('thread-one');
  await list.generateTitle('thread-one');

  expect(titled).toHaveBeenCalledTimes(1);
});

test('a delete reaches the door while another act of the list is still in flight', async () => {
  const list = open();
  removed.mockResolvedValue({ status: 'deleted', threadId: 'thread-dead' });
  titled.mockReturnValue(new Promise(() => undefined));

  void list.generateTitle('thread-other');
  const gone = await list.remove('thread-dead');

  expect(removed).toHaveBeenCalledTimes(1);
  expect(gone).toBe(true);
});

test('a delete of another row reaches the door while one delete never answers', async () => {
  const list = open();
  removed.mockImplementation((input: { id: string }) =>
    input.id === 'thread-stuck' ? new Promise(() => undefined) : Promise.resolve({ status: 'deleted', threadId: 'thread-dead' }),
  );

  void list.remove('thread-stuck');
  expect(list.busy('thread-stuck', 'delete')).toBe(true);
  const gone = await list.remove('thread-other');

  expect(gone).toBe(true);
  expect(removed).toHaveBeenCalledTimes(2);
  expect(list.busy('thread-stuck', 'delete')).toBe(true);
  expect(list.busy('thread-other', 'delete')).toBe(false);
});

test('a refusal releases the row\u2019s mark and answers false', async () => {
  const list = open();
  const refusal = new Refusal({ gate: true, code: 'delete-timed-out', reason: 'still being ended', unblock: [] });
  removed.mockRejectedValue(refusal);

  expect(await list.remove('thread-slow')).toBe(false);
  expect(list.busy('thread-slow', 'delete')).toBe(false);
  expect(app!.app.resolve(Notices).list).toMatchObject([{ kind: 'refusal', title: 'delete-timed-out', body: 'still being ended' }]);
  expect(reported).toEqual([]);
});

test('a second delete while one is going is refused, and the first still answers', async () => {
  const list = open();
  let settle: (answer: { status: string; threadId: string }) => void = () => undefined;
  removed.mockReturnValue(new Promise((resolve) => (settle = resolve)));

  const first = list.remove('thread-dead');
  const second = await list.remove('thread-dead');
  expect(second).toBe(false);
  expect(removed).toHaveBeenCalledTimes(1);

  settle({ status: 'deleted', threadId: 'thread-dead' });
  expect(await first).toBe(true);
});

test('a door answering that nothing was deleted is answered false, never true', async () => {
  const list = open();
  removed.mockResolvedValue(null);

  expect(await list.remove('thread-dead')).toBe(false);
});
