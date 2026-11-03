import { afterAll, beforeAll, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { e2e } from '@runlith/e2e/browser';

type SurfaceCache = { readonly url: string; readonly replace: () => void; readonly open: () => number };

let directory = '';
let entry = '';

beforeAll(async () => {
  const built = await Bun.build({
    entrypoints: [fileURLToPath(new URL('./testing/surfaceCache.ts', import.meta.url))],
    target: 'node',
    format: 'esm',
    external: ['electron'],
  });
  if (!built.success) throw new AggregateError(built.logs, 'the surface cache host did not build');
  directory = await mkdtemp(join(tmpdir(), 'surface-cache-'));
  entry = join(directory, 'main.mjs');
  await Bun.write(entry, built.outputs[0]!);
});

afterAll(async () => {
  if (directory !== '') await rm(directory, { recursive: true, force: true });
});

e2e(
  'a project window opens the current surface when its address still has a fresh cached copy of the previous build',
  async ({ electron, page }) => {
    const main = electron!;
    const url = await main.evaluate(() => (globalThis as unknown as { surfaceCache: SurfaceCache }).surfaceCache.url);
    await page.goto(url);
    expect(await page.locator('#build').textContent()).toBe('first');
    await main.evaluate(() => (globalThis as unknown as { surfaceCache: SurfaceCache }).surfaceCache.replace());
    await page.goto('about:blank');
    await page.goto(url);
    expect(await page.locator('#build').textContent()).toBe('first');

    const [opened] = await Promise.all([
      main.waitForEvent('window'),
      main.evaluate(() => (globalThis as unknown as { surfaceCache: SurfaceCache }).surfaceCache.open()),
    ]);
    await opened.waitForLoadState('load');
    expect(opened.url()).toBe(url);
    expect(await opened.locator('#build').textContent()).toBe('second');
  },
  {
    lanes: ['electron'],
    electron: () => ({ executablePath: createRequire(import.meta.url)('electron') as string, args: [entry] }),
  },
);
