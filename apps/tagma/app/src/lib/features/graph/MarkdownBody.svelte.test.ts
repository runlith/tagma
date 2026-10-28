// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { test as mountApp } from '@runlith/layer/svelte/test.svelte';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test } from 'vitest';
import { waitUntil } from '@runlith/testing/flush';
import { Overlays } from '$lib/app/overlays.js';
import { testAddressing } from '$lib/app/testing.js';
import TestHost from '$lib/app/TestHost.svelte';
import type { Link } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import type { PathCode } from '$lib/features/opening/pathCode.js';
import type { BlockRefPeer } from './blockRefView.js';
import { Refusal } from '$lib/wire/refusal.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';
import { Router } from '@runlith/layer/Router';
import { makeRouter } from '@runlith/layer/testing';
import MarkdownBody from './MarkdownBody.svelte';

const world = (opened: Link[]) =>
  mountApp(
    Layer.mergeAll(Overlays, testAddressing),
    Layer.mergeAll(
      ServerOrigin.of('https://tagma.test'),
      Layer.of(Router, makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') })),
      Layer.of(Opening, {
        knows: () => true,
        modified: () => false,
        how: () => 'beside',
        open: async (link: Link) => void opened.push(link),
        menu: () => undefined,
        tip: () => ({ text: null }),
      } as never),
    ),
  );

const pathRoad = (resolve: (path: string) => Promise<boolean>) => (path: string) =>
  resolve(path).then((available) => (available ? (code: PathCode): Link => ({ kind: 'file', target: code }) : null));

const pathOf = (link: Link): string => (link.target as PathCode).path;

function drawn(target: HTMLElement, props: Record<string, unknown>, opened: Link[]) {
  const app = world(opened);
  const host = mount(TestHost, { target, props: { app: app.app, view: MarkdownBody as never, props } });
  return async () => {
    await unmount(host);
    await app.unmount();
  };
}

test('file paths become actionable only after resolution and one click opens once', async () => {
  let confirm: (available: boolean) => void = () => undefined;
  const available = new Promise<boolean>((resolve) => {
    confirm = resolve;
  });
  const opened: Link[] = [];
  const path = '/outside/отчёт one.md';
  const target = document.createElement('div');
  const close = drawn(
    target,
    {
      text: `\`${path}\` and \`/missing.txt\` and [report](${encodeURI(path)}) and \`LICENSE\` and [site](//example.com/report)`,
      paths: pathRoad((candidate) => (candidate === path || candidate === 'LICENSE' ? available : Promise.resolve(false))),
    },
    opened,
  );
  try {
    await waitUntil(() => target.querySelectorAll('[data-path]').length === 4);
    expect(target.querySelector('a[href="//example.com/report"]')).not.toBeNull();
    expect(target.querySelectorAll('[role="link"]')).toHaveLength(0);
    target.querySelector<HTMLElement>('[data-path]')!.click();
    expect(opened).toEqual([]);
    confirm(true);
    await waitUntil(() => target.querySelectorAll('[role="link"]').length === 3);
    target.querySelector<HTMLElement>('[role="link"]')!.click();
    expect(opened.map(pathOf)).toEqual([path]);
    target.querySelector<HTMLElement>('[data-path="/missing.txt"]')!.click();
    expect(opened.map(pathOf)).toEqual([path]);
  } finally {
    await close();
  }
});

test('a commit id in code or text links to that commit in its project once confirmed, and an unconfirmed one stays code', async () => {
  const far = `b4dc210b5e${'1'.repeat(30)}`;
  const own = `9f8e7d6${'2'.repeat(33)}`;
  const asked: string[] = [];
  const opened: Link[] = [];
  const target = document.createElement('div');
  const close = drawn(
    target,
    {
      text: 'Landed in `b4dc210b5e`, then 9f8e7d6, not `deadbee`.',
      paths: pathRoad(async (path) => {
        asked.push(path);
        return false;
      }),
      commits: {
        locate: async (id: string) =>
          id === 'b4dc210b5e'
            ? { sha: far, subject: 'Fix the lease', project: 'shop' }
            : id === '9f8e7d6'
              ? { sha: own, subject: 'Land the scene', project: 'runlith' }
              : null,
      },
    },
    opened,
  );
  try {
    await waitUntil(() => target.querySelectorAll('a[data-commit-link]').length === 2);
    const anchors = [...target.querySelectorAll<HTMLElement>('a[data-commit-link]')];
    const links = anchors.map((link) => {
      const href = new URL(link.getAttribute('href') ?? '', 'https://tagma.test');
      return [link.textContent, href.pathname.split('/')[1], href.searchParams.get('commit')];
    });
    expect(links).toEqual([
      ['b4dc210b5e', 'shop', far],
      ['9f8e7d6', 'runlith', own],
    ]);
    anchors[0]!.click();
    expect(opened).toEqual([{ kind: 'commit', target: { sha: far, project: 'shop', subject: 'Fix the lease' }, from: undefined }]);
    expect(target.querySelector('code[data-commit="deadbee"]')?.closest('a')).toBeNull();
    expect(asked).toEqual([]);
  } finally {
    await close();
  }
});

test('path resolution waits for the closed entry and reads only its final rendered text', async () => {
  const props = $state({ text: '`Good', streaming: true });
  const requested: string[] = [];
  const opened: Link[] = [];
  const target = document.createElement('div');
  const close = drawn(
    target,
    {
      get text() {
        return props.text;
      },
      get streaming() {
        return props.streaming;
      },
      cacheKey: 'streamed-path',
      paths: pathRoad(async (path) => {
        requested.push(path);
        return true;
      }),
    },
    opened,
  );
  try {
    flushSync();
    expect(target.querySelector('code')?.textContent).toBe('Good');
    expect(requested).toEqual([]);

    props.text = '`Good day,';
    flushSync();
    expect(target.querySelector('code')?.textContent).toBe('Good day,');
    expect(requested).toEqual([]);
    expect(target.querySelector('[role="link"]')).toBeNull();

    props.text = '`Good day, Ana.`';
    props.streaming = false;
    await waitUntil(() => target.querySelector('[role="link"]')?.textContent === 'Good day, Ana.');
    expect(requested).toEqual(['Good day, Ana.']);
    target.querySelector<HTMLElement>('[role="link"]')!.click();
    expect(opened.map(pathOf)).toEqual(['Good day, Ana.']);
  } finally {
    await close();
  }
});

test('a streamed body keeps its settled DOM while reference reading moves from pending through refusal to resolution', async () => {
  const props = $state({ text: 'First [[5b386d76]] here.\n\nSecond.\n\nThi' });
  const peers = $state<Record<string, BlockRefPeer>>({});
  const opened: Link[] = [];
  const names = () => opened.map((link) => (link.target as { name: string }).name);
  const target = document.createElement('div');
  const close = drawn(
    target,
    {
      get text() {
        return props.text;
      },
      cacheKey: 'streamed-body',
      streaming: true,
      refs: { peer: (name: string) => peers[name], open: async () => undefined },
    },
    opened,
  );

  flushSync();
  const first = target.querySelector('p');
  expect(first?.textContent).toBe('First 5b386d76 here.');
  const pending = first!.querySelector('a')!;
  expect(pending.hasAttribute('href')).toBe(false);
  expect(pending.tabIndex).toBe(0);
  pending.click();
  pending.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(names()).toEqual(['5b386d76', '5b386d76']);

  const refusal = new Refusal({
    gate: true,
    code: 'ambiguous-name',
    reason: 'Two blocks share this address',
    unblock: ['Read a full address'],
  });
  peers['5b386d76'] = { error: refusal };
  flushSync();
  const anchor = first?.querySelector('a');
  expect(anchor?.title).toBe(refusal.message);
  expect(anchor?.hasAttribute('data-dead')).toBe(false);

  peers['5b386d76'] = { title: 'Inbox', project: 'runlith' };
  flushSync();
  expect(first?.textContent).toBe('First Inbox here.');
  expect(anchor?.hasAttribute('title')).toBe(false);
  expect(anchor?.getAttribute('href')).toBe('/runlith/b/5b386d76');
  anchor!.click();
  expect(names()).toEqual(['5b386d76', '5b386d76', '5b386d76']);

  props.text = 'First [[5b386d76]] here.\n\nSecond.\n\nThird.\n\nFour';
  flushSync();

  const paragraphs = [...target.querySelectorAll('p')];
  expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual(['First Inbox here.', 'Second.', 'Third.', 'Four']);
  expect(paragraphs[0]).toBe(first);

  await close();
});
