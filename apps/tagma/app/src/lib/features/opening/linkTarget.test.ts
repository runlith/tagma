// @vitest-environment jsdom
import PanelRight from '@lucide/svelte/icons/panel-right';
import { Host } from '@runlith/layer/Host';
import type { Resolver } from '@runlith/layer/key';
import { waitFor } from '@runlith/testing/flush';
import { flushSync, mount, unmount } from 'svelte';
import { expect, test, vi } from 'vitest';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import type { LinkHow, LinkPlace } from './Link.js';
import LinkRow from './LinkRow.fixture.svelte';
import { LinkRegistry } from './LinkRegistry.js';
import { LINK_OPENED, linkTarget, linkWithin } from './linkTarget.js';
import { Opening } from './Opening.svelte.js';

test('a link row of a menu opens its link once by click, Enter and Space, closes the menu only by opening, and its right click keeps the menu', async () => {
  const opened: [string, LinkHow][] = [];
  const place = (how: LinkHow): LinkPlace<string> => ({
    words: how,
    icon: PanelRight,
    open: (_app, link) => void opened.push([link.target, how]),
  });
  const kinds = new LinkRegistry([
    { links: [{ kind: 'note', what: () => 'note', beside: place('beside'), full: place('full') }] as never },
  ]);
  const opening = new Opening(kinds, {} as never, {} as never, { refusal: vi.fn() } as unknown as Notices, new Host('desktop', 'macos'));
  const target = document.createElement('div');
  document.body.append(target);
  const app = mount(LinkRow, { target, props: { opening, here: { resolve: () => undefined as never } } });
  flushSync();
  const trigger = (): HTMLElement => document.querySelector<HTMLElement>('[data-trigger]')!;
  const isOpen = (): boolean => trigger().getAttribute('aria-expanded') === 'true';
  const row = (): HTMLElement => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].at(-1)!;
  const press = (event: Event): void => {
    trigger().click();
    flushSync();
    row().focus();
    row().dispatchEvent(event);
    flushSync();
  };

  press(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
  expect(isOpen()).toBe(false);
  press(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  expect(isOpen()).toBe(false);
  press(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' }));
  expect(isOpen()).toBe(false);
  press(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  expect(isOpen()).toBe(true);

  expect(opened).toEqual([
    ['n-1', 'beside'],
    ['n-1', 'beside'],
    ['n-1', 'beside'],
  ]);
  expect(opening.aim?.link).toEqual({ kind: 'note', target: 'n-1' });
  await unmount(app);
  target.remove();
});

test('a link on an element and one within a root open beside by click and Enter, in full by the modifier, tell their container each time, and give their menu', async () => {
  const opened: [string, LinkHow][] = [];
  const place = (how: LinkHow): LinkPlace<string> => ({
    words: how,
    icon: PanelRight,
    open: (_app, link) => void opened.push([link.target, how]),
  });
  const kinds = new LinkRegistry([
    { links: [{ kind: 'note', what: () => 'note', beside: place('beside'), full: place('full') }] as never },
  ]);
  const opening = new Opening(kinds, {} as never, {} as never, { refusal: vi.fn() } as unknown as Notices, new Host('desktop', 'macos'));
  const here: Resolver = { resolve: () => undefined as never };

  const button = document.createElement('button');
  const root = document.createElement('div');
  const span = Object.assign(document.createElement('span'), { tabIndex: 0 });
  span.dataset['note'] = 'n-2';
  root.append(span);
  document.body.append(button, root);
  const signalled: EventTarget[] = [];
  document.addEventListener(LINK_OPENED, (event) => void signalled.push(event.target as EventTarget));
  linkTarget(opening, () => ({ kind: 'note', target: 'n-1' }), here)(button);
  linkWithin(opening, '[data-note]', (element) => ({ kind: 'note', target: element.dataset['note'] ?? '' }), here)(root);

  for (const element of [button, span]) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', metaKey: true }));
  }
  span.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 4, clientY: 8 }));

  await waitFor(() =>
    expect(opened).toEqual([
      ['n-1', 'beside'],
      ['n-1', 'beside'],
      ['n-1', 'full'],
      ['n-2', 'beside'],
      ['n-2', 'beside'],
      ['n-2', 'full'],
    ]),
  );
  expect(opening.aim).toMatchObject({ link: { kind: 'note', target: 'n-2' }, x: 4, y: 8, origin: span });
  expect(signalled).toEqual([button, button, button, span, span, span]);
});

test('the keyboard menu gesture in editable text gives the menu of the link under the caret, and a pointer there gives none, even on the focused root', () => {
  const place: LinkPlace<string> = { words: 'note', icon: PanelRight, open: () => undefined };
  const kinds = new LinkRegistry([{ links: [{ kind: 'note', what: () => 'note', beside: place, full: place }] as never }]);
  const opening = new Opening(kinds, {} as never, {} as never, { refusal: vi.fn() } as unknown as Notices, new Host('desktop', 'macos'));
  const root = document.createElement('div');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const text = document.createElement('p');
  const code = document.createElement('code');
  code.dataset['note'] = 'n-3';
  code.textContent = 'src/a.ts';
  text.append('see ', code);
  editable.append(text);
  root.append(editable);
  document.body.append(root);
  linkWithin(opening, '[data-note]', (element) => ({ kind: 'note', target: element.dataset['note'] ?? '' }), {
    resolve: () => undefined as never,
  })(root);
  editable.focus();
  document.getSelection()?.collapse(code.firstChild, 3);

  text.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 2, clientY: 3 }));
  editable.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 4, clientY: 5 }));
  expect(opening.aim).toBeNull();
  editable.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 6, clientY: 7 }));
  expect(opening.aim).toMatchObject({ link: { kind: 'note', target: 'n-3' }, x: 6, y: 7, origin: code });
  root.remove();
});

test('a kind with no place beside opens its full place by click and modified click, and its menu has one step to open it', async () => {
  const opened: LinkHow[] = [];
  const full: LinkPlace<string> = { words: 'full', icon: PanelRight, open: () => void opened.push('full') };
  const kinds = new LinkRegistry([{ links: [{ kind: 'folder', what: () => 'folder', full }] as never }]);
  const opening = new Opening(kinds, {} as never, {} as never, { refusal: vi.fn() } as unknown as Notices, new Host('desktop', 'macos'));
  const here: Resolver = { resolve: () => undefined as never };
  const button = document.body.appendChild(document.createElement('button'));
  linkTarget(opening, () => ({ kind: 'folder', target: 'src' }), here)(button);

  button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true }));

  await waitFor(() => expect(opened).toEqual(['full', 'full']));
  expect(opening.shape({ kind: 'folder', target: 'src' }, here)?.steps.map((step) => [step.how, step.keys])).toEqual([
    ['full', opening.keys(false)],
  ]);
  button.remove();
});
