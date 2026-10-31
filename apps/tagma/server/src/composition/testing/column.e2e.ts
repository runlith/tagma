import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import type { Page } from 'playwright-core';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';
import { scriptedModel } from './scriptedModel.js';

type Box = { readonly title: string; readonly top: number; readonly bottom: number };

const titles = ['Idle first', 'Answered second', 'Idle third', 'Answered fourth', 'Answered fifth', 'Idle sixth'];

const rows = (page: Page) =>
  page.evaluate<Box[]>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const rows = [...document.querySelectorAll('aside[aria-label="Agents"] [data-line]')];
    resolve(rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { title: row.innerText.split('\\n')[0] ?? '', top: rect.top, bottom: rect.bottom };
    }).sort((left, right) => left.top - right.top));
  })))`);

const contiguous = (stage: string, boxes: readonly Box[]) => {
  const gaps = boxes.slice(1).map((box, index) => ({ row: box.title, gap: Math.round((box.top - boxes[index]!.bottom) * 10) / 10 }));
  expect({ stage, gaps }).toEqual({ stage, gaps: gaps.map((one) => ({ row: one.row, gap: 1 })) });
};

const working = (page: Page, title: string, running: boolean) =>
  page.waitForFunction(`(() => {
    const lines = [...document.querySelectorAll('aside[aria-label="Agents"] [data-line]')];
    const grown = lines.some((row) => row.innerText.startsWith(${JSON.stringify(title)}) && row.offsetHeight > 30);
    const separated = lines.some((row) => row.dataset.line === 'line:quiet');
    return grown && separated === ${running};
  })()`);

e2e.effect(
  'the thread column lays its rows one after another at their measured heights while a thread starts and ends working',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld();
      const tenant = yield* served.tenant;
      const ids = new Map<string, string>();
      for (const [index, title] of titles.entries()) {
        const thread = yield* tenant.thread({ title });
        ids.set(title, thread.id);
        if (title.startsWith('Answered')) yield* tenant.turn(thread.id, { key: `column-${index}`, text: `Answer ${title}.` });
      }
      const opened = yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat/${ids.get('Idle first')}`);
        const column = page.locator('aside[aria-label="Agents"]');
        for (const title of titles) await column.getByText(title, { exact: true }).waitFor();
        return rows(page);
      });
      expect(opened.length).toBeGreaterThanOrEqual(titles.length);
      contiguous('opened', opened);

      const release = yield* Deferred.make<void>();
      yield* served.world.lend({
        models: scriptedModel(
          Stream.concat(Stream.succeed('Working on it.'), Stream.fromEffect(Deferred.await(release).pipe(Effect.as(' Done.')))),
        ),
      });
      const live = yield* Effect.forkChild(tenant.turn(ids.get('Idle third')!, { key: 'column-live', text: 'Keep working for a while.' }));
      contiguous('working', yield* Effect.promise(() => working(page, 'Idle third', true).then(() => rows(page))));

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(live);
      contiguous('rested', yield* Effect.promise(() => working(page, 'Idle third', false).then(() => rows(page))));
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);
