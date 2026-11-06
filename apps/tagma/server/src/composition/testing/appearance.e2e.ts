import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { Effect } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';

const PAINT = { choice: 'light', variants: { dark: { declarations: '--background:#2e3440;', chrome: '#242933' } } };

const SEEDED = `
  localStorage.setItem('appearance.paint', ${JSON.stringify(JSON.stringify(PAINT))});
  const seen = new MutationObserver(() => {
    if (document.body === null) return;
    seen.disconnect();
    const root = document.documentElement;
    window.firstPaint = {
      background: getComputedStyle(root).getPropertyValue('--background').trim(),
      dark: root.classList.contains('dark'),
      chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
      bundled: document.querySelector('[data-sveltekit-hydrate], #svelte-announcer') !== null,
    };
  });
  seen.observe(document, { childList: true, subtree: true });
`;

e2e.effect('a window opens in the theme its last paint kept, before its bundle runs', ({ page }) =>
  Effect.gen(function* () {
    const served = yield* makeE2eWorld();
    const first = yield* Effect.promise(async () => {
      await page.addInitScript({ content: SEEDED });
      await page.goto(served.origin);
      return page.evaluate('window.firstPaint');
    });
    expect(first).toEqual({ background: '#2e3440', dark: true, chrome: '#242933', bundled: false });
  }),
);
