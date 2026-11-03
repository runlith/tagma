import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { Effect } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';

const CARD = '[data-connect-model]';
const PENDING = '[data-model-pending]';
const MODEL = 'button[aria-label="Model and reasoning"]';
const SIGNED_OUT = '[data-signed-out]';

e2e.effect(
  'a new thread waits for the Claude Code login, offers other ways meanwhile, then shows its model with no connect card',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld({ logins: { claude: 'held', codex: 'absent' } });
      const tenant = yield* served.tenant;
      yield* served.logins.started('claude');
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat`);
        await page.locator(PENDING).waitFor();
        expect(await page.locator(CARD).count()).toBe(0);
        await page.getByRole('button', { name: 'Connect another way', exact: true }).click();
        await page.locator(CARD).waitFor();
        expect(await page.locator(PENDING).count()).toBe(1);
      });
      yield* served.logins.answer('claude', 'signed-in');
      yield* Effect.promise(async () => {
        await page.locator(MODEL).waitFor();
        expect(await page.locator(PENDING).count()).toBe(0);
        expect(await page.locator(CARD).count()).toBe(0);
      });
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);

e2e.effect(
  'an unsent draft keeps its offered Claude model through a sign-out, stops the send, and sends once signed in again',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld({ logins: { claude: 'signed-in', codex: 'signed-in' } });
      const tenant = yield* served.tenant;
      const words = 'Start on the open draft.';
      const offered = yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat`);
        await page.locator(MODEL).waitFor();
        return page.locator(MODEL).innerText();
      });
      yield* served.logins.answer('claude', 'signed-out');
      yield* Effect.promise(async () => {
        await page.locator(SIGNED_OUT).waitFor();
        expect(await page.locator(MODEL).innerText()).toBe(offered);
        const composer = page.locator('textarea.prompt');
        await composer.fill(words);
        await composer.press('Enter');
        await page.waitForFunction(`document.querySelector('textarea.prompt')?.value === ${JSON.stringify(words)}`);
        expect(page.url()).toBe(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat`);
        expect(await page.locator(MODEL).innerText()).toBe(offered);
      });
      yield* served.logins.answer('claude', 'signed-in');
      yield* Effect.promise(async () => {
        await page.locator(SIGNED_OUT).waitFor({ state: 'detached' });
        expect(await page.locator(MODEL).innerText()).toBe(offered);
        await page.locator('textarea.prompt').press('Enter');
        await page.getByText('echo: heard', { exact: true }).waitFor();
      });
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);

e2e.effect(
  'a new thread with no CLI signed in offers the connect card',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld({ logins: { claude: 'signed-out', codex: 'absent' } });
      const tenant = yield* served.tenant;
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat`);
        await page.locator(CARD).waitFor();
        expect(await page.locator(MODEL).count()).toBe(0);
      });
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);
