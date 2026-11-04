import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import type { Page } from 'playwright-core';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { makeE2eWorld } from './e2eWorld.js';
import { scriptedModel } from './scriptedModel.js';

e2e.effect(
  'a working thread drops into a new group folder and stays filed after reload',
  ({ page }) =>
    Effect.gen(function* () {
      const served = yield* makeE2eWorld();
      const tenant = yield* served.tenant;
      const member = yield* served.tenant;
      yield* tenant.perform('make_group', {
        name: served.world.uniqueName(),
        projects: [String(tenant.projectId), String(member.projectId)],
      });
      const release = yield* Deferred.make<void>();
      const entered = yield* Deferred.make<void>();
      yield* served.world.lend({
        models: scriptedModel(
          Stream.fromEffect(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as('Done.'))),
        ),
      });
      const thread = yield* tenant.thread({ title: 'Folder drag' });
      const live = yield* Effect.forkChild(tenant.turn(thread.id, { key: 'folder-drag', text: 'Keep working.' }));
      yield* Deferred.await(entered);
      yield* Effect.promise(async () => {
        await page.goto(`${served.origin}/${encodeURIComponent(tenant.projectName)}/chat/${thread.id}`);
        const column = page.locator('aside[aria-label="Agents"]');
        const row = column.locator(`a[data-thread="${thread.id}"]`);
        await row.waitFor();
        await column.getByRole('button', { name: 'New thread', exact: true }).click();
        await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
        const name = column.getByRole('textbox', { name: 'Folder name' });
        await name.fill('Business');
        await name.press('Enter');
        await name.waitFor({ state: 'detached' });
        const folder = column.locator('[data-folder-head]');
        const folderId = await folder.getAttribute('data-folder-head');
        const empty = column.locator(`[data-column-line="empty:folder:${folderId}"]`);
        const from = await row.boundingBox();
        const into = await empty.boundingBox();
        expect(from).not.toBeNull();
        expect(into).not.toBeNull();
        const filed = page.waitForResponse((response) => response.url().includes('/api/op/file_threads'));
        await page.mouse.move(from!.x + 60, from!.y + from!.height / 2);
        await page.mouse.down();
        await page.mouse.move(into!.x + 60, into!.y + into!.height / 2, { steps: 12 });
        await page.mouse.up();
        expect(await (await filed).json()).toMatchObject({ status: 'filed', folderId, moved: [thread.id] });
        await page.waitForFunction(
          `document.querySelector('[data-column-line="${thread.id}"]')?.getAttribute('data-drop') === ${JSON.stringify(`folder:${folderId}`)}`,
        );
        await page.reload();
        await row.waitFor();
        expect(await row.locator('xpath=ancestor::*[@data-column-line][1]').getAttribute('data-drop')).toBe(`folder:${folderId}`);
      });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(live);
    }),
  { lanes: ['chromium'], context: { viewport: { width: 1280, height: 800 } } },
);

type Box = { readonly title: string; readonly key: string; readonly top: number; readonly bottom: number; readonly clipped: boolean };

const titles = ['Idle first', 'Answered second', 'Idle third', 'Answered fourth', 'Answered fifth', 'Idle sixth'];

const rows = (page: Page) =>
  page.evaluate<Box[]>(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const rows = [...document.querySelectorAll('aside[aria-label="Agents"] [data-column-line]')];
    resolve(rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        title: row.innerText.split('\\n')[0] ?? '',
        key: row.dataset.columnLine ?? '',
        top: rect.top,
        bottom: rect.bottom,
        clipped: row.scrollHeight > row.offsetHeight,
      };
    }).sort((left, right) => left.top - right.top));
  })))`);

const contiguous = (stage: string, boxes: readonly Box[]) => {
  const gaps = boxes.slice(1).map((box, index) => ({ row: box.title, gap: Math.round((box.top - boxes[index]!.bottom) * 10) / 10 }));
  expect({ stage, gaps }).toEqual({ stage, gaps: gaps.map((one) => ({ row: one.row, gap: 1 })) });
  expect({ stage, clipped: boxes.filter((box) => box.clipped).map((box) => box.key) }).toEqual({ stage, clipped: [] });
  expect({ stage, rules: boxes.filter((box) => box.key.startsWith('line:')).map((box) => box.bottom - box.top) }).toEqual({
    stage,
    rules: boxes.filter((box) => box.key.startsWith('line:')).map(() => 9),
  });
};

const working = (page: Page, title: string, running: boolean) =>
  page.waitForFunction(`(() => {
    const lines = [...document.querySelectorAll('aside[aria-label="Agents"] [data-column-line]')];
    const grown = lines.some((row) => row.innerText.startsWith(${JSON.stringify(title)}) && row.offsetHeight > 30);
    const separated = lines.some((row) => row.dataset.columnLine === 'line:quiet');
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
