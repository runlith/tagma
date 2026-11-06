import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import type { Page } from 'playwright-core';
import { Effect } from 'effect';
import { writePlugin } from '../../plugin-formats/tagma/testing/folder.js';
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

const BACKGROUND = '#15171c';

const paints = (window: Page, background: string) =>
  window.waitForFunction(
    `getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === ${JSON.stringify(background)}`,
  );

e2e.effect('a theme chosen in one window’s menu paints every open window, and a reloaded window opens in it', ({ page }) =>
  Effect.gen(function* () {
    const served = yield* makeE2eWorld();
    const tenant = yield* served.tenant;
    const root = yield* served.world.directory('nord-theme');
    yield* Effect.promise(() =>
      writePlugin(root, {
        id: 'nord',
        contributes: { themes: { nord: { title: 'Nord', dark: { surfaces: { background: BACKGROUND } } } } },
      }),
    );
    yield* tenant.perform('install_plugin', { source: root, scope: 'user' });
    const at = `${served.origin}/${encodeURIComponent(tenant.projectName)}`;
    yield* Effect.promise(async () => {
      const second = await page.context().newPage();
      await Promise.all([page.goto(at), second.goto(at)]);
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('menuitem', { name: /^Theme/ }).click();
      await page.getByRole('menuitemradio', { name: 'Nord', exact: true }).click();
      await Promise.all([paints(page, BACKGROUND), paints(second, BACKGROUND)]);
      expect(await second.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
      await second.reload();
      await paints(second, BACKGROUND);
    }).pipe(
      Effect.ensuring(
        Effect.ignore(
          Effect.andThen(
            tenant.perform('write_setting_layer', { scope: 'user', key: 'appearance.theme', value: 'tagma' }),
            tenant.perform('uninstall_plugin', { id: 'nord' }),
          ),
        ),
      ),
    );
  }),
);
