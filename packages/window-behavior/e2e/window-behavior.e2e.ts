import { expect } from 'bun:test';
import { e2e } from '@runlith/e2e/browser';
import type { ElectronApplication, Page } from 'playwright-core';
import { example } from './examples.fixture.ts';

const minimal = example('electron-minimal');

e2e(
  'minimal example applies always-on-top and capture protection to the BrowserWindow',
  async ({ page, electron }) => {
    await waitForMinimal(page);

    await page.getByRole('button', { name: 'Toggle always on top' }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).alwaysOnTop === true);
    expect((await readWindowEffects(electron!)).alwaysOnTop).toBe(true);

    await page.getByRole('button', { name: 'Toggle capture protection' }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).captureProtection === true);
    expect((await readWindowEffects(electron!)).contentProtection).toBe(true);
  },
  minimal,
);

e2e(
  'minimal example applies transparent opacity changes to the BrowserWindow',
  async ({ page, electron }) => {
    await waitForMinimal(page);

    await page.getByRole('button', { name: 'Toggle transparent mode' }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).transparent === true);

    await setRangeValue(page, '#window-opacity', 40);
    await page.waitForFunction(() => Math.abs(JSON.parse(document.querySelector('#state')!.textContent!).windowOpacity - 0.4) < 0.000005);
    expect((await readWindowEffects(electron!)).opacity).toBeCloseTo(0.4, 5);
  },
  minimal,
);

e2e(
  'minimal example applies no-focus-steal with the expected host mode',
  async ({ page, electron }) => {
    await waitForMinimal(page);

    await page.getByRole('button', { name: 'Toggle focus policy' }).click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#state')!.textContent!).focusPolicy === 'no-focus-steal');

    const meta = await page.evaluate(() => window.windowBehaviorExample.getMeta());
    await page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('#focus-input');
      return input !== null && !input.disabled && !input.readOnly;
    });
    await page.locator('#focus-input').click();
    await page.waitForFunction(() => document.activeElement === document.querySelector('#focus-input'));

    if (meta.noFocusStealSupport.status === 'disabled') {
      const hostMode = await electron!.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('No BrowserWindow instance is available.');
        return { focusListeners: window.listenerCount('focus'), blurListeners: window.listenerCount('blur') };
      });
      expect(hostMode.focusListeners).toBeGreaterThan(0);
      expect(hostMode.blurListeners).toBeGreaterThan(0);
    }
  },
  minimal,
);

e2e(
  'overlay example applies overlay and pass-through state changes',
  async ({ page }) => {
    await page.getByText('Overlay playground').waitFor({ state: 'visible' });
    await page.waitForFunction(async () => (await window.windowBehaviorOverlayExample.getState()).alwaysOnTop === true);

    await page.getByRole('button', { name: 'Background' }).click();
    await page.waitForFunction(async () => (await window.windowBehaviorOverlayExample.getState()).overlayBackgroundVisible === false);
    await page.waitForFunction(() => /background-hidden/.test(document.querySelector('#root')!.className));

    await setRangeValue(page, '#background-opacity', 45);
    await page.waitForFunction(
      async () => Math.abs((await window.windowBehaviorOverlayExample.getState()).overlayBackgroundOpacity - 0.45) < 0.000005,
    );

    await page.getByRole('button', { name: 'Click-through' }).click();
    await page.waitForFunction(async () => (await window.windowBehaviorOverlayExample.getState()).passThrough === true);
  },
  example('electron-overlay-playground'),
);

async function waitForMinimal(page: Page) {
  await page.getByRole('heading', { name: 'Minimal headless capability example' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#state')?.textContent?.includes('"alwaysOnTop"'));
}

async function readWindowEffects(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('No BrowserWindow instance is available.');
    return {
      alwaysOnTop: window.isAlwaysOnTop(),
      opacity: window.getOpacity(),
      contentProtection: typeof window.isContentProtected === 'function' ? window.isContentProtected() : false,
    };
  });
}

async function setRangeValue(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Expected a range input.');
    element.value = String(nextValue);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
