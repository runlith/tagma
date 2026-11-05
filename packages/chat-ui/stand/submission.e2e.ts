import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import { stand } from '@runlith/e2e/stand';
import type { Page } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import type { ComposerStandGlobal } from './port';
import { ready } from './scenarios';

const served = stand(fileURLToPath(new URL('./vite.config.ts', import.meta.url)));

const frames = (page: Page) => page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.frames(6));
const position = (page: Page) =>
  page.evaluate(() => {
    const state = (globalThis as ComposerStandGlobal).feedStand!.state();
    const current = document.querySelector('[role="navigation"] [aria-current="location"]');
    const latest = document.querySelector('[role="navigation"] li:last-child button');
    return {
      gap: state.height - state.viewport - state.top,
      current: current?.getAttribute('aria-label'),
      latest: latest?.getAttribute('aria-label'),
    };
  });

async function history(page: Page): Promise<void> {
  await page.locator('[role="navigation"] button').first().click();
  await frames(page);
  expect((await position(page)).gap).toBeGreaterThan(800);
}

async function tail(page: Page): Promise<void> {
  await frames(page);
  const at = await position(page);
  expect(at.gap).toBeLessThanOrEqual(1);
  expect(at.current).toBe(at.latest);
}

for (const lane of ['chromium', 'webkit'] as const) {
  e2e(
    'a direct composer send returns an old thread to its tail through a new date',
    async ({ page }) => {
      await page.goto(served.url('/?count=24&loaded=24&idle=1'));
      await ready(page);
      await history(page);
      await page.locator('textarea').fill('A new message.\nIts second line.\nIts third line.');
      expect(await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.send())).toBe(true);
      await tail(page);

      await history(page);
      await page.locator('textarea').fill('Another message from the keyboard.');
      await page.locator('textarea').press('Enter');
      await page.waitForFunction(() => !(globalThis as ComposerStandGlobal).feedStand!.sending());
      await tail(page);
    },
    { lanes: [lane], context: { viewport: { width: 1100, height: 800 } } },
  );

  e2e(
    'a send from history or with the live answer selected lands at the tail and keeps following it',
    async ({ page }) => {
      const stream = (chunks: number) => page.evaluate((chunks) => (globalThis as ComposerStandGlobal).feedStand!.stream(chunks), chunks);
      await page.goto(served.url('/?count=200&loaded=200'));
      await ready(page);
      await stream(4);
      await tail(page);
      for (const prompt of [
        'One more thing.',
        Array.from({ length: 14 }, (_, line) => `Line ${line + 1} of a long dictated prompt that wraps across the bubble.`).join('\n'),
      ]) {
        await history(page);
        await stream(12);
        await frames(page);
        expect((await position(page)).gap).toBeGreaterThan(800);
        await page.locator('textarea').fill(prompt);
        const streaming = stream(8);
        await page.locator('textarea').press('Enter');
        await streaming;
        await tail(page);
        await stream(3);
        await tail(page);
      }

      await page.locator('textarea').blur();
      await page
        .locator('[data-timeline-key="stream-answer"] p')
        .first()
        .evaluate((text) => {
          const range = document.createRange();
          range.selectNodeContents(text);
          window.getSelection()!.removeAllRanges();
          window.getSelection()!.addRange(range);
        });
      await page.locator('textarea').evaluate((area: HTMLTextAreaElement) => {
        area.setRangeText('Dictated while the answer stands selected.', 0, area.value.length, 'end');
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.send())).toBe(true);
      await stream(8);
      expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(false);
      await tail(page);
    },
    { lanes: [lane], context: { viewport: { width: 1100, height: 800 } } },
  );

  e2e(
    'keyboard focus moving to a control above the view takes the feed off the tail and keeps the control in view',
    async ({ page }) => {
      await page.goto(served.url('/?count=24&loaded=24'));
      await ready(page);
      await tail(page);
      const focusable = '[data-scrollable][role="group"] :is(button, a[href], summary, [tabindex="0"])';
      await page
        .locator(focusable)
        .last()
        .evaluate((control: HTMLElement) => control.focus({ preventScroll: true }));
      const shown = () =>
        page.evaluate(() => {
          const root = document.querySelector<HTMLElement>('[data-scrollable][role="group"]')!;
          const active = document.activeElement;
          if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
          const box = active.getBoundingClientRect();
          const view = root.getBoundingClientRect();
          return box.bottom > view.top && box.top < view.bottom;
        });
      let away = false;
      for (let step = 0; step < 60 && !away; step += 1) {
        await page.keyboard.press('Shift+Tab');
        await frames(page);
        away = (await position(page)).gap > 200;
      }
      expect(away).toBe(true);
      expect(await shown()).toBe(true);
      await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.stream(3));
      await frames(page);
      expect(await shown()).toBe(true);
      expect((await position(page)).gap).toBeGreaterThan(200);
    },
    { lanes: [lane], context: { viewport: { width: 1100, height: 800 } } },
  );

  e2e(
    'a queued composer submission resumes following until the reader moves away again',
    async ({ page }) => {
      await page.goto(served.url('/?count=24&loaded=24'));
      await ready(page);
      await history(page);
      await page.locator('textarea').fill('Read this after the current turn.');
      await page.locator('textarea').press('Tab');
      await page.waitForFunction(() => !(globalThis as ComposerStandGlobal).feedStand!.sending());
      await tail(page);
      await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.stream(2));
      await tail(page);

      const point = await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.point());
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, -1000);
      await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.wheelSettled());
      await frames(page);
      const reading = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('[data-scrollable][role="group"]')!;
        const edge = root.getBoundingClientRect().top;
        const row = [...root.querySelectorAll<HTMLElement>('[data-timeline-key]')].find(
          (node) => node.getBoundingClientRect().bottom > edge,
        )!;
        return { key: row.dataset.timelineKey!, top: row.getBoundingClientRect().top };
      });
      expect((await position(page)).gap).toBeGreaterThan(800);
      await page.evaluate(() => (globalThis as ComposerStandGlobal).feedStand!.stream(2));
      await frames(page);
      const held = await page.locator(`[data-timeline-key="${reading.key}"]`).boundingBox();
      expect(held).not.toBeNull();
      expect(Math.abs(held!.y - reading.top)).toBeLessThanOrEqual(1);
      expect((await position(page)).gap).toBeGreaterThan(800);
    },
    { lanes: [lane], context: { viewport: { width: 1100, height: 800 } } },
  );
}
