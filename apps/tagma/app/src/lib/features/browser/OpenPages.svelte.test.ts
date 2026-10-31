import { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { Disposition, Page, PagesEvent } from '@tagma/server/browser/contract/wire/page';
import { expect, test } from 'vitest';
import type { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { testArea, testKind } from '$lib/app/panes/testing.js';
import type { PlacesPort } from '$lib/app/panes/ThreadPlaces.js';
import type { LiveConnection } from '$lib/wire/Live.js';
import { OpenPages } from './OpenPages.svelte.js';
import { BROWSER_PANE, browserPane } from './panes.js';
import { pageOf } from './testing/page.js';

function world(standing: readonly Page[], project = 1) {
  const { panes, layouts } = testArea([testKind(BROWSER_PANE)]);
  const elsewhere: string[] = [];
  const seats: PlacesPort = {
    place: () => {
      throw new Error('Pages are placed through openFor.');
    },
    openFor: (_layouts, thread, content) => {
      elsewhere.push(`${thread} ${content.id}`);
      return { kind: 'opened', key: 'elsewhere' };
    },
    ask: () => undefined,
  };
  let take: (event: PagesEvent) => void = () => undefined;
  const live = {
    hold: (_open: unknown, frame: (event: PagesEvent) => void) => {
      take = frame;
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  new OpenPages({ projectId: project }, live, seats, layouts, panes, 'desktop');
  take({ type: 'list', pages: standing });
  const opened = (id: string, opener: string, disposition: Disposition, over: Partial<Page> = {}) =>
    take({ type: 'put', page: pageOf(id, { opener: PageId.make(opener), ...over }), disposition });
  return { panes, elsewhere, opened };
}

const strip = (panes: SidePanes) => panes.panes.map((tab) => `${tab.id}${tab.agent === true ? ' agent' : ''}`);
const tabOf = (panes: SidePanes, page: string) => panes.panes.find((tab) => tab.id === `1:${page}`)!.key;

test('a tab a shown page opens lands right after it, and takes the screen only for a plain click on the page in view', () => {
  const { panes, opened } = world([pageOf('docs'), pageOf('other')]);
  panes.open(browserPane({ project: 1, page: PageId.make('docs') }));
  panes.open(browserPane({ project: 1, page: PageId.make('other') }));
  panes.activate(tabOf(panes, 'docs'));

  opened('clicked', 'docs', 'tab');
  expect(strip(panes)).toEqual(['1:docs', '1:clicked', '1:other']);
  expect(panes.active?.id).toBe('1:clicked');

  panes.activate(tabOf(panes, 'docs'));
  opened('behind', 'docs', 'background-tab');
  expect(strip(panes)).toEqual(['1:docs', '1:behind', '1:clicked', '1:other']);
  expect(panes.active?.id).toBe('1:docs');

  panes.activate(tabOf(panes, 'other'));
  opened('scripted', 'docs', 'tab');
  expect(strip(panes)).toEqual(['1:docs', '1:scripted', '1:behind', '1:clicked', '1:other']);
  expect(panes.active?.id).toBe('1:other');
});

test('an agent’s click opens its tab behind with the agent mark; with no opener tab shown the page goes to its thread or stays tabless', () => {
  const driven = pageOf('driven', { openedBy: 'lead', live: { ...pageOf('driven').live, driven: 'lead' } });
  const { panes, elsewhere, opened } = world([driven, pageOf('hidden')]);
  panes.open(browserPane({ project: 1, page: PageId.make('driven') }));

  opened('agents', 'driven', 'tab', { openedBy: 'lead' });
  expect(strip(panes)).toEqual(['1:driven', '1:agents agent']);
  expect(panes.active?.id).toBe('1:driven');

  opened('threads', 'hidden', 'tab', { openedBy: 'lead' });
  opened('operators', 'hidden', 'tab');
  expect(elsewhere).toEqual(['lead 1:threads']);
  expect(strip(panes)).toEqual(['1:driven', '1:agents agent']);
});

test('a page whose opener stands as a tab on another project’s screen opens beside it there', () => {
  const { panes, opened } = world([pageOf('portable')], 2);
  panes.open(browserPane({ project: 2, page: PageId.make('portable') }));

  opened('child', 'portable', 'tab');
  expect(strip(panes)).toEqual(['2:portable', '2:child']);
  expect(panes.active?.id).toBe('2:child');
});
