import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { Deferred, Effect, Stream } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';
import { scriptedModel } from './scriptedModel.js';

const message = 'Read this message through the real app.';
const beginning = 'The scripted reply has begun.';
const ending = 'The scripted reply is complete.';
const paragraph =
  'This paragraph gives the reader enough history to scroll back through the reply while the real feed renders the streamed result.';

e2e.effect(
  'a sent message streams its reply into the thread and the reader scrolls it',
  ({ page }) =>
    Effect.gen(function* () {
      const finish = yield* Deferred.make<void>();
      const chunks = Stream.concat(
        Stream.succeed(`${beginning}\n\n${Array.from({ length: 18 }, (_, at) => `${at + 1}. ${paragraph}`).join('\n\n')}\n\n`),
        Stream.fromEffect(Deferred.await(finish).pipe(Effect.as(ending))),
      );
      const served = yield* makeE2eWorld({ models: scriptedModel(chunks) });
      const tenant = yield* served.tenant;
      const thread = yield* tenant.thread({ title: 'A streamed conversation' });
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat/${thread.id}`);
        const composer = page.locator('textarea.prompt');
        await composer.fill(message);
        await composer.press('Enter');
        await page.getByText(message, { exact: true }).waitFor();
        await page.getByText(beginning, { exact: true }).waitFor();
      });
      yield* Deferred.succeed(finish, undefined);
      yield* Effect.promise(async () => {
        await page.getByText(ending, { exact: true }).waitFor();
        const scroller = page.locator('[data-scrollable][role="group"]');
        await page.waitForFunction(`document.querySelector('[data-scrollable][role="group"]')?.scrollTop > 0`);
        const before = await scroller.evaluate((element) => element.scrollTop);
        await scroller.hover();
        await page.mouse.wheel(0, -600);
        await page.waitForFunction(`document.querySelector('[data-scrollable][role="group"]')?.scrollTop < ${before}`);
        expect(await scroller.evaluate((element) => element.scrollTop)).toBeLessThan(before);
      });
    }),
  { lanes: ['chromium', 'webkit'], context: { viewport: { width: 1280, height: 800 } } },
);
