// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { Router } from '@runlith/layer/Router';
import { makeRouter } from '@runlith/layer/testing';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import TestHost from '$lib/app/TestHost.svelte';
import { Overlays } from '$lib/app/overlays.js';
import { testAddressing } from '$lib/app/testing.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { CommitLinks } from '$lib/features/checkout/CommitLinks.svelte.js';
import { ProjectRung } from '$lib/features/workspace/ProjectRung.js';
import { TileRung } from '$lib/features/workspace/TileRung.js';
import { GraphRung } from '$lib/features/workspace/GraphRung.js';
import type { Link } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import type { PathCode } from '$lib/features/opening/pathCode.js';
import { ThreadNames } from '$lib/shared/threads/Names.svelte.js';
import BlockRefText from './BlockRefText.svelte';

test('a plain message opens confirmed file paths at their location and retires pending links when the message changes', async () => {
  const path = '/Users/ana/.tagma/scratch/brief-terminal.md';
  const text = $state({
    value: `Read ${path}:12:3, then (${path}). Keep /missing.md and /pending.md as text. https://example.com/?next=/etc/hosts //example.com/#/etc/hosts`,
  });
  const first = Promise.withResolvers<boolean>();
  const pending = Promise.withResolvers<boolean>();
  const signals: AbortSignal[] = [];
  const opened: unknown[] = [];
  const menus: unknown[] = [];
  const spot = (link: Link) => {
    const code = link.target as PathCode;
    return [code.path, code.line, code.column];
  };
  const opening = {
    knows: () => true,
    modified: (event: MouseEvent) => event.metaKey,
    how: (modified: boolean) => (modified ? 'full' : 'beside'),
    open: async (link: Link, how: string) => void opened.push([...spot(link), how]),
    menu: (link: Link, at: { x: number; y: number }) => void menus.push([...spot(link), at]),
    tip: () => ({ text: null }),
  };
  const app = mountApp(
    Layer.mergeAll(ThreadNames, Overlays, testAddressing),
    Layer.mergeAll(
      Layer.of(Router, makeRouter()),
      Layer.of(BlockTitles, { peer: () => undefined } as never),
      Layer.of(CommitLinks, { peer: () => undefined } as never),
      Layer.of(Opening, opening as never),
    ),
    {
      ladder: [TileRung, ProjectRung, GraphRung],
      at: { tile: { tileId: 1 }, project: { projectId: 1 }, graph: { projectId: 1, branch: null } },
    },
  );
  const target = document.createElement('div');
  const view = mount(TestHost, {
    target,
    props: {
      app: app.app,
      view: BlockRefText as never,
      props: {
        get text() {
          return text.value;
        },
        paths: (candidate: string, signal: AbortSignal) => {
          signals.push(signal);
          const found =
            candidate === path
              ? first.promise
              : candidate === '/pending.md'
                ? pending.promise
                : Promise.resolve(candidate === '/etc/hosts');
          return found.then((available) => (available ? (code: PathCode): Link => ({ kind: 'file', target: code }) : null));
        },
      },
    },
  });
  try {
    flushSync();
    expect(target.querySelector('[data-open-paths]')?.textContent).toBe(text.value);
    target.querySelector<HTMLElement>('[data-path]')!.click();
    expect(opened).toEqual([]);
    first.resolve(true);
    await waitUntil(() => target.querySelectorAll('[data-openable]').length === 2);
    const link = target.querySelector<HTMLElement>('[data-openable]')!;
    link.click();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    link.dispatchEvent(new MouseEvent('click', { metaKey: true, bubbles: true }));
    expect(opened).toEqual([
      [path, 12, 3, 'beside'],
      [path, 12, 3, 'beside'],
      [path, 12, 3, 'full'],
    ]);
    link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 8, clientY: 9 }));
    expect(menus).toEqual([[path, 12, 3, { x: 8, y: 9 }]]);
    target.querySelector<HTMLElement>('[data-path="/missing.md"]')!.click();
    expect(opened).toHaveLength(3);

    text.value = 'No file here';
    flushSync();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    pending.resolve(true);
    await pending.promise;
    expect(target.querySelector('[data-open-paths]')?.textContent).toBe(text.value);
    expect(target.querySelectorAll('[data-openable]')).toHaveLength(0);
  } finally {
    await unmount(view);
    await app.unmount();
  }
});
