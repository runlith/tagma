// @vitest-environment jsdom
import PanelRight from '@lucide/svelte/icons/panel-right';
import { Host } from '@runlith/layer/Host';
import type { Resolver } from '@runlith/layer/key';
import { makeRouterWithLog } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import type { LinkHow, LinkPlace } from './Link.js';
import { testLinks } from '$lib/app/testing.js';
import { Opening } from './Opening.svelte.js';

test('the one anchor listener opens declared anchors by the rule, takes modified clicks on app routes inside the app, and leaves the rest to the page', () => {
  const { router, visited } = makeRouterWithLog({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') });
  const opened: [string, LinkHow][] = [];
  const place = (how: LinkHow): LinkPlace<string> => ({
    words: how,
    icon: PanelRight,
    open: (_app, link) => void opened.push([link.target, how]),
  });
  const kinds = testLinks(
    [
      {
        kind: 'site',
        what: () => 'site',
        beside: place('beside'),
        full: place('full'),
        anchor: (_app: Resolver, href: string) => (href.startsWith('https://example.com/') ? { kind: 'site', target: href } : null),
      },
    ] as never,
    [],
  );
  const opening = new Opening(kinds, {} as never, {} as never, {} as never, new Host('desktop', 'macos'));
  const detach = opening.attach({ resolve: () => undefined as never });
  const stop = opening.listen(router);
  const anchor = (href: string, target = ''): HTMLAnchorElement => {
    const made = document.createElement('a');
    made.href = href;
    made.target = target;
    document.body.append(made);
    return made;
  };
  const route = anchor('https://tagma.test/runlith/b/db391956?diff=3..');
  const resource = anchor('https://tagma.test/api/threads/t1/attachments/a1', '_blank');
  const site = anchor('https://example.com/page');
  const left: boolean[] = [];
  const page = (event: MouseEvent): void => {
    left.push(!event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener('click', page);
  const click = (target: HTMLElement, metaKey: boolean): void =>
    void target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey }));

  click(route, true);
  click(resource, true);
  click(site, false);
  click(site, true);
  click(route, false);

  expect(left).toEqual([false, true, false, false, true]);
  expect(visited.map((visit) => visit.href)).toEqual(['/runlith/b/db391956?diff=3..']);
  expect(opened).toEqual([
    ['https://example.com/page', 'beside'],
    ['https://example.com/page', 'full'],
  ]);
  window.removeEventListener('click', page);
  stop();
  detach();
  document.body.replaceChildren();
});

test('an app route a kind owns stays the page’s click, opens beside on the modified click, and offers its menu naming the click as the full place', () => {
  const { router, visited } = makeRouterWithLog({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith') });
  const opened: [string, LinkHow][] = [];
  const place = (how: LinkHow): LinkPlace<string> => ({
    words: how,
    icon: PanelRight,
    open: (_app, link) => void opened.push([link.target, how]),
  });
  const kinds = testLinks(
    [
      {
        kind: 'note',
        what: () => 'note',
        beside: place('beside'),
        full: place('full'),
        route: (_app: Resolver, anchor: HTMLAnchorElement) =>
          anchor.dataset['note'] === undefined ? null : { kind: 'note', target: anchor.dataset['note'] },
      },
    ] as never,
    [],
  );
  const opening = new Opening(kinds, {} as never, { contextProject: null } as never, {} as never, new Host('desktop', 'macos'));
  const detach = opening.attach({ resolve: () => undefined as never });
  const stop = opening.listen(router);
  const anchor = (href: string, note?: string): HTMLAnchorElement => {
    const made = document.createElement('a');
    made.href = href;
    if (note !== undefined) made.dataset['note'] = note;
    document.body.append(made);
    return made;
  };
  const owned = anchor('https://tagma.test/runlith/b/db391956', 'db391956');
  const other = anchor('https://tagma.test/runlith/chat');
  const left: boolean[] = [];
  const page = (event: MouseEvent): void => {
    left.push(!event.defaultPrevented);
    event.preventDefault();
  };
  window.addEventListener('click', page);
  window.addEventListener('contextmenu', page);
  const fire = (target: HTMLElement, type: 'click' | 'contextmenu', metaKey = false): void =>
    void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, metaKey, button: type === 'click' ? 0 : 2 }));

  fire(owned, 'click');
  fire(owned, 'click', true);
  fire(other, 'click', true);
  fire(other, 'contextmenu');
  expect(opening.aim).toBeNull();
  fire(owned, 'contextmenu');

  expect(left).toEqual([true, false, false, true, false]);
  expect(opened).toEqual([['db391956', 'beside']]);
  expect(visited.map((visit) => visit.href)).toEqual(['/runlith/chat']);
  const aim = opening.aim;
  expect(aim?.link).toEqual({ kind: 'note', target: 'db391956' });
  expect(opening.shape(aim!.link, aim!.app, aim!.click)?.steps.map((step) => [step.how, step.keys])).toEqual([
    ['full', opening.keys(false)],
    ['beside', opening.keys(true)],
  ]);
  window.removeEventListener('click', page);
  window.removeEventListener('contextmenu', page);
  stop();
  detach();
  document.body.replaceChildren();
});
