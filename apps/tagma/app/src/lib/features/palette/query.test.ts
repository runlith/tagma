import { expect, test } from 'vitest';
import { narrowed, nextChip, prefixed } from './query.js';

test('a leading sign aims the query at one group and leaves the rest as the text', () => {
  expect(prefixed('>theme dark')).toEqual({ aim: 'actions', text: 'theme dark' });
  expect(prefixed('  @ trips')).toEqual({ aim: 'threads', text: 'trips' });
  expect(prefixed('#spec')).toEqual({ aim: 'blocks', text: 'spec' });
  expect(prefixed('?why is it slow')).toEqual({ aim: 'ask', text: 'why is it slow' });
  expect(prefixed('a > b')).toEqual({ aim: null, text: 'a > b' });
});

test('tag and status narrow only when they name something the catalog declares', () => {
  expect(narrowed('tag:task status:open fix', ['task'], ['open'])).toEqual({ text: 'fix', tag: 'task', status: 'open' });
  expect(narrowed('tag:nothing fix', ['task'], ['open'])).toEqual({ text: 'tag:nothing fix', tag: null, status: null });
});

test('Tab walks the chips round in both directions', () => {
  expect(nextChip('all', 1)).toBe('projects');
  expect(nextChip('actions', 1)).toBe('all');
  expect(nextChip('all', -1)).toBe('actions');
});
