import { PageId } from '@tagma/server/browser/contract/wire/ids';
import { expect, test } from 'vitest';
import { completion, partsOf } from './address.js';
import { listingOf, type SuggestionSources, suggestions } from './suggestions.js';
import { pageOf } from './testing/page.js';

const NONE = listingOf({ served: [], open: [], closed: [], current: null });

test('the first row is what Enter does: an address goes there, words search', () => {
  expect(suggestions('github.com/runlith', null, NONE)[0]).toMatchObject({ kind: 'go', url: 'https://github.com/runlith' });
  expect(suggestions('react hooks', null, NONE)[0]).toEqual({
    kind: 'search',
    url: 'https://www.google.com/search?q=react%20hooks',
    query: 'react hooks',
  });
});

test('a typed host prefix completes to a served origin, whose row carries the command once', () => {
  const listing = listingOf({ served: [{ url: 'http://localhost:5193/', label: 'tagma:try' }], open: [], closed: [], current: null });
  const done = completion('loc', ['http://localhost:5193/']);
  expect(done).toEqual({ text: 'localhost:5193', url: 'http://localhost:5193/' });
  expect(completion('localhost:5193/', ['http://localhost:5193/'])).toBeNull();
  expect(suggestions('loc', done, listing)).toEqual([
    { kind: 'go', url: 'http://localhost:5193/', title: null, icon: null, label: 'tagma:try' },
    { kind: 'search', url: 'https://www.google.com/search?q=loc', query: 'loc' },
  ]);
});

test('nothing is listed before a letter; then host starts rank first and the list holds at most six rows', () => {
  const guide = pageOf('guide', { url: 'https://docs.example.com/github-guide', title: 'Guide' });
  const repo = pageOf('repo', { url: 'https://github.com/runlith', title: 'runlith' });
  const sources: SuggestionSources = {
    served: [],
    open: [pageOf('shown'), guide, repo],
    closed: Array.from({ length: 9 }, (_, at) => pageOf(`gone${at}`, { url: `https://site${at}.example.com/` })),
    current: PageId.make('shown'),
  };
  const listing = listingOf(sources);
  expect(suggestions('', null, listing)).toEqual([]);
  expect(suggestions('git', null, listing).map((row) => [row.kind, row.url])).toEqual([
    ['search', 'https://www.google.com/search?q=git'],
    ['open', repo.url],
    ['open', guide.url],
  ]);
  expect(suggestions('site', null, listing)).toHaveLength(6);
});

test('an address reads by its host: no https or www, a decoded path, only Google itself read as a search', () => {
  expect(partsOf('https://www.npmjs.com/settings/runlith')).toEqual({
    scheme: '',
    host: 'npmjs.com',
    rest: '/settings/runlith',
    query: null,
  });
  expect(partsOf('http://example.com/%D0%B4%D0%BE%D0%BA')).toMatchObject({ scheme: 'http://', rest: '/док' });
  expect(partsOf('http://localhost:5173/')).toMatchObject({ scheme: '', host: 'localhost:5173', rest: '' });
  expect(partsOf('https://www.google.com/search?q=%D1%82%D0%B5%D1%81%D1%82').query).toBe('тест');
  expect(partsOf('https://google.evil.example/search?q=trusted')).toMatchObject({ host: 'google.evil.example', query: null });
});
