import type { AppStateEvent } from '@tagma/server/app-state/contract/wire/documents';
import { Failure } from '@runlith/layer/Failure';
import type { PlatformStorage } from '@runlith/layer/Platform';
import { Scope } from '@runlith/layer/Scope';
import { makeStorage } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import type { Door } from '$lib/wire/Door.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { ServerAppState } from './ServerAppState.svelte.js';

const KEY = 'tagma.strip';

type Write = { readonly key: string; readonly value: string | null; readonly writer: string };

const drained = () => new Promise<void>((done) => setTimeout(done, 0));

function server(documents: Record<string, string> = {}) {
  let revision = 0;
  const kept = new Map<string, { readonly value: string | null; readonly revision: number }>();
  for (const [key, value] of Object.entries(documents)) kept.set(key, { value, revision: ++revision });
  const feeds = new Set<(event: AppStateEvent) => void>();
  let opened: Promise<void> = Promise.resolve();
  let refusing = false;
  const publish = (event: AppStateEvent) => {
    for (const feed of feeds) feed(event);
  };
  const door = {
    perform: async (id: string, input: Write) => {
      if (id === 'read_app_state') {
        const standing = [...kept].flatMap(([key, kept]) =>
          kept.value === null ? [] : [{ key, value: kept.value, revision: kept.revision }],
        );
        const at = revision;
        await opened;
        return { status: 'read', documents: standing, revision: at };
      }
      if (refusing) throw new Error('the write was refused');
      kept.set(input.key, { value: input.value, revision: ++revision });
      publish({ kind: 'changed', ...input, revision });
      return { status: 'written', revision };
    },
  } as unknown as Door;
  const live = {
    hold: (_open: unknown, onItem: (event: AppStateEvent) => void) => {
      feeds.add(onItem);
      onItem({ kind: 'current', revision });
      return { unsubscribe: () => void feeds.delete(onItem) };
    },
  } as unknown as LiveConnection;
  return {
    kept,
    publish,
    refuse: (refuses: boolean) => void (refusing = refuses),
    missed: (key: string, value: string) => {
      kept.set(key, { value, revision: ++revision });
      return revision;
    },
    hold: () => {
      let release!: () => void;
      opened = new Promise((done) => (release = done));
      return () => release();
    },
    window: (local: PlatformStorage = makeStorage()) => {
      const failures: unknown[] = [];
      const state = new ServerAppState(door, live, Scope.make(), new Failure((error) => failures.push(error)), local, [KEY]);
      const heard: (string | null)[] = [];
      state.watch(KEY, (value) => heard.push(value));
      return { state, heard, failures };
    },
  };
}

test('a window reads nothing and refuses a write until the documents arrive, then tells its watchers what stands', async () => {
  const at = server({ [KEY]: '{"members":[1]}' });
  const release = at.hold();
  const window = at.window();

  expect([window.state.ready, window.state.getItem(KEY)]).toEqual([false, null]);
  expect(() => window.state.setItem(KEY, '{"members":[2]}')).toThrow();

  release();
  await drained();
  expect([window.state.ready, window.state.getItem(KEY), window.heard]).toEqual([true, '{"members":[1]}', ['{"members":[1]}']]);
  expect(window.failures).toEqual([]);
});

test('one window’s write reaches the other at once, its own echo tells it nothing, and an older change from elsewhere never overwrites it', async () => {
  const at = server();
  const here = at.window();
  const there = at.window();
  await drained();
  here.heard.length = 0;
  there.heard.length = 0;

  here.state.setItem(KEY, '{"members":[1,2]}');
  await drained();
  expect([here.heard, there.heard, there.state.getItem(KEY)]).toEqual([[], ['{"members":[1,2]}'], '{"members":[1,2]}']);

  const written = at.kept.get(KEY)!.revision;
  at.publish({ kind: 'changed', key: KEY, value: '{"members":[9]}', revision: written - 1, writer: 'elsewhere' });
  expect([here.state.getItem(KEY), there.state.getItem(KEY), here.heard]).toEqual(['{"members":[1,2]}', '{"members":[1,2]}', []]);

  at.publish({ kind: 'changed', key: KEY, value: null, revision: written + 1, writer: 'elsewhere' });
  expect([here.state.getItem(KEY), here.heard]).toEqual([null, [null]]);
});

test('a refused write is reported and the window reads back what the server holds, even past a read already in flight', async () => {
  const at = server({ [KEY]: '{"members":[1]}' });
  const window = at.window();
  await drained();

  const release = at.hold();
  at.publish({ kind: 'current', revision: at.missed('tagma.rail', '{"pinned":[]}') });
  window.state.setItem(KEY, '{"members":[2]}');
  await drained();
  at.refuse(true);
  window.state.setItem(KEY, '{"members":[3]}');
  await drained();
  at.refuse(false);
  release();
  await drained();

  expect([window.state.getItem(KEY), window.state.getItem('tagma.rail'), window.failures.length]).toEqual([
    '{"members":[2]}',
    '{"pinned":[]}',
    1,
  ]);
});

test('a reconnect reads again when the window heard a newer change but missed an older one', async () => {
  const at = server();
  const window = at.window();
  await drained();

  at.missed('tagma.rail', '{"pinned":["rules"]}');
  const heard = at.missed(KEY, '{"members":[5]}');
  at.publish({ kind: 'changed', key: KEY, value: '{"members":[5]}', revision: heard, writer: 'elsewhere' });
  at.publish({ kind: 'current', revision: heard });
  await drained();

  expect([window.state.getItem(KEY), window.state.getItem('tagma.rail')]).toEqual(['{"members":[5]}', '{"pinned":["rules"]}']);
});

test('an arrangement this browser kept locally moves to the server once and leaves local storage; one the server already holds wins', async () => {
  const at = server();
  const local = makeStorage({ [KEY]: '{"members":[3]}' });
  const first = at.window(local);
  await drained();
  expect([at.kept.get(KEY)?.value, local.getItem(KEY), first.heard]).toEqual(['{"members":[3]}', null, ['{"members":[3]}']]);

  const other = makeStorage({ [KEY]: '{"members":[4]}' });
  const second = at.window(other);
  await drained();
  expect([second.state.getItem(KEY), other.getItem(KEY), at.kept.get(KEY)?.value]).toEqual(['{"members":[3]}', null, '{"members":[3]}']);
});
