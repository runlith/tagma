import { makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { settingsHref } from './address.js';

test('settings and its sections retain the branch without carrying a journal range', () => {
  const graph = makeRouter({ params: { project: 'runlith' }, url: new URL('https://tagma.test/runlith?branch=feature%2Fone&diff=2..4') });
  const settings = new URL(settingsHref(graph), graph.url);
  expect(settings.pathname).toBe('/settings');
  expect([...settings.searchParams]).toEqual([['branch', 'feature/one']]);

  const section = new URL(settingsHref(makeRouter({ url: settings }), 'agent'), settings);
  expect([...section.searchParams]).toEqual([
    ['branch', 'feature/one'],
    ['section', 'agent'],
  ]);

  const plain = makeRouter({ url: new URL('https://tagma.test/settings') });
  expect(settingsHref(plain)).toBe('/settings');
  expect(settingsHref(plain, 'agent')).toBe('/settings?section=agent');
});
