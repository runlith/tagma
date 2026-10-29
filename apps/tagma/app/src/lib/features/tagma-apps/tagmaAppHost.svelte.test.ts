// @vitest-environment jsdom
import type { PresenceRow } from '@tagma/server/threads/contract/wire/presence';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';
import type { ThreadPresence } from '$lib/features/presence/Presence.svelte.js';
import type { ViewCall, ViewParams } from '../views/ViewBridge.js';
import { type TagmaAppHostOwners, tagmaAppHost, THREAD_CHANGED } from './tagmaAppHost.svelte.js';

class Watched {
  known = $state(true);
  problem = $state<string | null>(null);
  current = $state.raw<PresenceRow | undefined>(undefined);
  row = () => this.current;
  missing = () => undefined;
}

const rowOf = (life: string, text: string): PresenceRow =>
  ({ status: { life, runId: life === 'working' ? 'run-1' : null }, tail: null, saidLine: text, outcome: null }) as unknown as PresenceRow;

test('a thread the view stops watching sends nothing more and gives back its presence hold', async () => {
  const set = new Watched();
  set.current = rowOf('idle', 'first');
  let held = 0;
  const presence = {
    watch: () => {
      held += 1;
      return { set, release: () => (held -= 1) };
    },
  } as unknown as ThreadPresence;
  const host = tagmaAppHost({ presence } as unknown as TagmaAppHostOwners, {
    projectId: 1,
    tagmaApp: 'poker',
    view: 'table',
    threadId: null,
    key: null,
  });
  const told: ViewParams[] = [];
  const mount = new AbortController();
  const call = (): ViewCall => ({
    signal: new AbortController().signal,
    mounted: mount.signal,
    notify: (method, params) => {
      if (method === THREAD_CHANGED) told.push(params);
    },
  });

  const reading = host.methods['tagma/thread']!({ threadId: 't1' }, call());
  flushSync();
  expect(await reading).toMatchObject({ threadId: 't1', text: 'first' });
  set.current = rowOf('working', 'second');
  flushSync();
  expect(told).toHaveLength(1);
  expect(held).toBe(1);

  expect(await host.methods['tagma/thread/unwatch']!({ threadId: 't1' }, call())).toEqual({ watched: true });
  expect(held).toBe(0);
  set.current = rowOf('idle', 'third');
  flushSync();
  expect(told).toHaveLength(1);
  expect(await host.methods['tagma/thread/unwatch']!({ threadId: 't1' }, call())).toEqual({ watched: false });

  set.known = false;
  const pending = host.methods['tagma/thread']!({ threadId: 't1' }, call());
  flushSync();
  await host.methods['tagma/thread/unwatch']!({ threadId: 't1' }, call());
  await expect(pending).rejects.toThrow();
  expect(held).toBe(0);

  set.known = true;
  const again = host.methods['tagma/thread']!({ threadId: 't1' }, call());
  flushSync();
  expect(await again).toMatchObject({ text: 'third' });
  expect(held).toBe(1);
  mount.abort();
  set.current = rowOf('working', 'fourth');
  flushSync();
  expect(told).toHaveLength(1);
  expect(held).toBe(0);
});
