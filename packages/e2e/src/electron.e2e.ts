import { expect } from 'bun:test';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { e2e } from './browser.ts';

e2e(
  'an isolated hidden Electron renderer answers an interaction',
  async ({ page, electron }) => {
    await page.locator('button').click();
    expect(await page.locator('output').textContent()).toBe('42');
    expect(await electron!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible()))).toBe(
      true,
    );
  },
  {
    lanes: ['electron'],
    electron: () => ({
      executablePath: createRequire(import.meta.url)('electron') as string,
      args: [join(import.meta.dir, 'testing/hidden.mjs')],
    }),
  },
);
