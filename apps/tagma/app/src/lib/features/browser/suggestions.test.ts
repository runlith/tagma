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
  ]);
});

test('an empty field lists running servers, the other open pages and closed pages not open again, in that order', () => {
  const shown = pageOf('shown');
  const other = pageOf('other');
  const sources: SuggestionSources = {
    served: [{ url: 'http://localhost:5173/', label: 'bun run dev' }],
    open: [shown, other],
    closed: [pageOf('gone'), pageOf('again', { url: other.url })],
    current: PageId.make('shown'),
  };
  expect(suggestions('', null, listingOf(sources)).map((row) => [row.kind, row.url])).toEqual([
    ['served', 'http://localhost:5173/'],
    ['open', other.url],
    ['recent', 'https://example.com/gone'],
  ]);
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
