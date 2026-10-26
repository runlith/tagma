// @vitest-environment jsdom
import PanelRight from '@lucide/svelte/icons/panel-right';
import { Host } from '@runlith/layer/Host';
import { Layer } from '@runlith/layer/Layer';
import type { Resolver } from '@runlith/layer/key';
import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { mountShell, type TestApp } from '$lib/app/testing.js';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import type { LinkHow, LinkPlace } from './Link.js';
import LinkMenu from './LinkMenu.svelte';
import { LINK_OPENED } from './linkTarget.js';
import { LinkRegistry } from './LinkRegistry.js';
import { Opening } from './Opening.svelte.js';

let app: TestApp | undefined;

afterEach(async () => {
  await app?.unmount();
  app = undefined;
});

test('a step chosen in the link menu opens the link it was chosen on, whatever the menu shows by the time it runs, and tells the element it came from', async () => {
  const opened: [string, LinkHow][] = [];
  const refused: unknown[] = [];
  const place = (how: LinkHow): LinkPlace<string> => ({
    words: how,
    icon: PanelRight,
    open: (_app, link) => void opened.push([link.target, how]),
  });
  const kinds = new LinkRegistry([
    { links: [{ kind: 'note', what: () => 'note', beside: place('beside'), full: place('full') }] as never },
  ]);
  const notices = { refusal: (error: unknown) => void refused.push(error) } as unknown as Notices;
  const opening = new Opening(kinds, {} as never, {} as never, notices, new Host('desktop', 'macos'));
  app = mountShell(Layer.mergeAll(Layer.of(Opening, opening), Layer.of(Notices, notices)));
  app.draw(LinkMenu as never);
  const here: Resolver = { resolve: () => undefined as never };

  const origin = document.body.appendChild(document.createElement('button'));
  let told = 0;
  origin.addEventListener(LINK_OPENED, () => (told += 1));
  opening.menu({ kind: 'note', target: 'n-1' }, { x: 10, y: 10 }, here, origin);
  flushSync();
  document.querySelector('[data-link-step="full"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(opening.aim).toBeNull();
  expect(told).toBe(1);
  opening.menu({ kind: 'note', target: 'n-2' }, { x: 10, y: 10 }, here);

  await vi.waitFor(() => expect(opened).toEqual([['n-1', 'full']]));
  expect(refused).toEqual([]);
});
