// @vitest-environment jsdom
import { Layer } from '@runlith/layer/Layer';
import { makeRouter } from '@runlith/layer/testing';
import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { flushSync } from 'svelte';
import { afterEach, expect, test } from 'vitest';
import { mountShell, testAddresses, type TestApp, testTagCatalog } from '$lib/app/testing.js';
import { type BlockPlace, type BlockRefPeer, placedHref } from '$lib/features/graph/blockRefView.js';
import { BlockTitles } from '$lib/features/graph/BlockTitles.svelte.js';
import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';
import type { Link } from '$lib/features/opening/Link.js';
import { Opening } from '$lib/features/opening/Opening.svelte.js';
import BlockCard from './BlockCard.svelte';

const block = { name: '5940aab8', tags: ['claim'], fields: {}, title: 'What the act changed' };

const global = { id: 8, name: 'global', rootPath: '/home/tagma/global', storage: 'stealth' } as Project;
const beta = { id: 9, name: 'beta', rootPath: '/repo/beta', storage: 'team' } as Project;

const router = makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') });
const addresses = testAddresses(router);

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

function card(peer: BlockRefPeer, props: { diff?: string; place?: BlockPlace }) {
  const opened: Link[] = [];
  const titles = {
    peer: () => peer,
    placed: (name: string, place: BlockPlace, diff?: string) =>
      placedHref(addresses, name, place, [global, beta].find((project) => project.id === place.projectId) ?? null, diff),
  };
  const opening = {
    knows: () => true,
    modified: () => false,
    how: () => 'beside',
    open: async (link: Link) => void opened.push(link),
    tip: () => ({ text: null }),
  };
  app = mountShell(
    Layer.mergeAll(Layer.of(TagCatalog, testTagCatalog()), Layer.of(BlockTitles, titles as never), Layer.of(Opening, opening as never)),
    Layer.mergeAll(),
    { at: { projectId: 1, branch: null }, router },
  );
  const link = app.draw(BlockCard as never, { block, ...props }).querySelector('a') as HTMLAnchorElement;
  flushSync();
  return { href: link.getAttribute('href'), link, opened };
}

test('a card opens the block in the copy its address names, at the journal range it was given', () => {
  const there = { title: block.title, project: 'orbit', branch: 'next' };
  expect(card(there, { diff: '8412..8447' }).href).toBe('/orbit/b/5940aab8?branch=next&diff=8412..8447');
});

test('a card carrying the place its answer wrote opens there before any name lookup answers', () => {
  const place = { projectId: global.id, checkout: '/home/tagma/global' };
  expect(card(undefined, { diff: '8412..8447', place }).href).toBe('/global/b/5940aab8?diff=8412..8447');
});

test('a write card keeps its checkout branch and journal range when name lookup points to another copy', () => {
  const place = { projectId: beta.id, checkout: '/repo/beta-subject', branch: 'subject/topic' };
  const peer = { title: block.title, project: beta.name, branch: null };
  expect(card(peer, { diff: '8412..8447', place }).href).toBe('/beta/b/5940aab8?branch=subject%2Ftopic&diff=8412..8447');
});

test('a card opens its block by the link rule, with the copy its answer wrote and its journal range', () => {
  const unresolved = card(undefined, { diff: '8412..8447' });
  expect(unresolved.href).toBeNull();
  unresolved.link.click();
  expect(unresolved.opened.map((link) => link.target)).toEqual([{ name: '5940aab8', copy: undefined, diff: '8412..8447' }]);

  const placed = card(undefined, {
    diff: '8412..8447',
    place: { projectId: beta.id, checkout: '/repo/beta-subject', branch: 'subject/topic' },
  });
  placed.link.click();
  expect(placed.opened.map((link) => link.target)).toEqual([
    { name: '5940aab8', copy: { projectId: beta.id, branch: 'subject/topic' }, diff: '8412..8447' },
  ]);
});
