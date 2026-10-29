import { makeRouter } from '@runlith/layer/testing';
import { expect, test } from 'vitest';
import { currentLanguage, diffLensHref, diffRangeOf, languageLensHref, settingsHref } from './address.js';

test('the translation and diff lenses replace each other in the address and keep the branch', () => {
  const translated = makeRouter({ url: new URL('https://tagma.test/runlith/b/5940aab8?branch=next&lang=ru') });
  expect(currentLanguage(translated)).toBe('ru');
  const since = '2026-10-29T18:57:51.224Z';
  expect(diffLensHref(translated, since)).toBe(`/runlith/b/5940aab8?branch=next&diff=${encodeURIComponent(since)}`);
  expect(diffRangeOf(since)).toEqual({ kind: 'since', at: since });

  const diffed = makeRouter({ url: new URL('https://tagma.test/runlith/b/5940aab8?branch=next&diff=3..') });
  expect(currentLanguage(diffed)).toBeNull();
  expect(languageLensHref(diffed, 'pt-BR')).toBe('/runlith/b/5940aab8?branch=next&lang=pt-BR');
  expect(languageLensHref(translated, null)).toBe('/runlith/b/5940aab8?branch=next');
});

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
