import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { Effect } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';

const CARD = '[data-connect-model]';
const PENDING = '[data-model-pending]';
const MODEL = 'button[aria-label="Model and reasoning"]';

e2e.effect(
  'a new thread waits for the Claude Code login, then offers its model with no connect card',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld({ logins: { claude: 'held', codex: 'absent' } });
      const tenant = yield* served.tenant;
      yield* served.logins.started('claude');
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat`);
        await page.locator(PENDING).waitFor();
        expect(await page.locator(CARD).count()).toBe(0);
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
