// @vitest-environment jsdom
import type { WorktreeFeedEvent, WorktreePlace, WorktreeRow, WorktreeWindow } from '@tagma/server/worktrees/contract/wire/rows';
import { Failure } from '@runlith/layer/Failure';
import { Scope } from '@runlith/layer/Scope';
import { makeRouter } from '@runlith/layer/testing';
import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { Worktrees } from './BoardState.svelte.js';

type Subscription = { readonly range: WorktreeWindow; readonly frame: (event: WorktreeFeedEvent) => void; active: boolean };

const place = (index: number): WorktreePlace => ({
  index,
  rootId: `root-${index}` as WorktreePlace['rootId'],
  kind: index === 0 ? 'main' : 'tagma',
  name: `tree-${index}`,
  folder: `/repo/${index}`,
  branch: `branch-${index}`,
  base: null,
  hue: null,
  head: `head-${index}`,
  headTime: 0,
  missing: false,
  agents: { working: 0, waiting: 0, finished: 0, standing: 1 },
  threads: [`thread-${index}`],
  setup: 'none',
  taskId: null,
  pending: null,
  movedAt: null,
});

const row = (one: WorktreePlace): WorktreeRow => ({
  ...one,
  status: 'idle',
  check: 'unknown',
  ahead: null,
  behind: null,
  uncommitted: null,
  reading: 'pending',
  diff: null,
  stateFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
  mergeFact: { state: 'untaken', head: null, base: null, baseTime: null, takenAt: null },
});

test('visible ranges retain only their facts while offscreen thread membership survives scrolling and metadata deltas', async () => {
  const subscriptions: Subscription[] = [];
  const live = {
    hold(open: (client: unknown) => unknown, frame: Subscription['frame']) {
      let range: WorktreeWindow = { start: 0, limit: 0 };
      open({
        'worktrees.subscribe': (input: WorktreeWindow) => {
          range = input;
        },
      });
      const held = { range, frame, active: true };
      subscriptions.push(held);
      return {
        unsubscribe: () => {
          held.active = false;
        },
      };
    },
  } as unknown as LiveConnection;
  let intersect: IntersectionObserverCallback = () => undefined;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const scope = Scope.make();
  const failure = new Failure((error) => {
    throw error;
  });
  const worktrees = new Worktrees(
    { projectId: 1 },
    live,
    makeRouter(),
    new ProjectFocus(() => ({ projectId: 1 }), { projectId: 1 }),
    {} as never,
    new Notices(scope),
    scope,
    failure,
  );
  const places = [place(0), place(1), place(2), place(3)];
  subscriptions[0]?.frame({ kind: 'list', places, rows: [], elsewhere: [], start: 0, total: places.length });
  const stop = $effect.root(() => {
    const window = worktrees.window();
    const first = document.createElement('div');
    const second = document.createElement('div');
    const detachFirst = window.observe('root-1')(first);
    const detachSecond = window.observe('root-2')(second);
    const hit = (target: Element, isIntersecting: boolean) => ({ target, isIntersecting }) as IntersectionObserverEntry;
    const visible = () => subscriptions.filter((held) => held.active && held.range.limit > 0);
    intersect([hit(first, true), hit(second, true)], {} as IntersectionObserver);
    flushSync();
    expect(visible().map((held) => held.range)).toEqual([{ projectId: 1, start: 1, limit: 2 }]);
    visible()[0]?.frame({ kind: 'list', rows: [row(places[1]!), row(places[2]!)], elsewhere: [], start: 1, total: places.length });
    expect(window.rowOf('root-1')?.head).toBe('head-1');
    expect(worktrees.placeOf('thread-3')?.rootId).toBe('root-3');
    intersect([hit(first, false)], {} as IntersectionObserver);
    flushSync();
    expect(visible().map((held) => held.range)).toEqual([{ projectId: 1, start: 2, limit: 1 }]);
    expect(window.rowOf('root-1')).toBe(null);
    subscriptions[0]?.frame({ kind: 'places', upsert: [{ ...places[3]!, threads: ['moved'] }], removed: [] });
    expect(worktrees.standingOf('moved')).toEqual({ kind: 'row', row: { ...places[3]!, threads: ['moved'] } });
    detachFirst?.();
    detachSecond?.();
  });
  stop();
  expect(subscriptions.filter((held) => held.active).map((held) => held.range.limit)).toEqual([0]);
  await scope.close();
  vi.unstubAllGlobals();
});
