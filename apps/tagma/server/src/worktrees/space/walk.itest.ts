import { afterAll, beforeAll, expect, test } from 'bun:test';
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walk } from './walk.js';

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'space-walk-'));
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'src', 'deep', 'a.ts'), 'x'.repeat(10_000));
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'y'.repeat(50_000));
  writeFileSync(join(root, 'src', 'build.log'), 'z'.repeat(5_000));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const bounds = { readers: 3, progressEvery: 2, items: 10 };

test('a walk sums the whole tree, counts what git ignores as reclaimable, and ranks the top-level items by size', async () => {
  let progressed = 0;
  const walked = await walk(root, new Set(['node_modules', 'src/build.log']), bounds, new AbortController().signal, () => {
    progressed += 1;
  });
  expect(walked.entries).toBe(7);
  expect(walked.items.map((item) => item.name)).toEqual(['node_modules', 'src']);
  const [modules, source] = walked.items;
  expect(modules?.reclaimable).toBe(modules?.bytes);
  expect(source?.reclaimable).toBeGreaterThan(0);
  expect(source?.reclaimable).toBeLessThan(source?.bytes ?? 0);
  expect(walked.reclaimable).toBe((modules?.reclaimable ?? 0) + (source?.reclaimable ?? 0));
  expect(progressed).toBeGreaterThan(0);
});

test('a file hard-linked twice in the place is counted once', async () => {
  const linked = mkdtempSync(join(tmpdir(), 'space-walk-links-'));
  try {
    writeFileSync(join(linked, 'one'), 'x'.repeat(40_000));
    linkSync(join(linked, 'one'), join(linked, 'two'));
    const single = mkdtempSync(join(tmpdir(), 'space-walk-single-'));
    writeFileSync(join(single, 'one'), 'x'.repeat(40_000));
    const once = await walk(single, new Set(), bounds, new AbortController().signal, () => undefined);
    rmSync(single, { recursive: true, force: true });
    const twice = await walk(linked, new Set(), bounds, new AbortController().signal, () => undefined);
    expect(twice.bytes).toBe(once.bytes);
  } finally {
    rmSync(linked, { recursive: true, force: true });
  }
});

test('an aborted walk ends with the abort', async () => {
  const stop = new AbortController();
  stop.abort(new Error('cancelled'));
  await expect(walk(root, new Set(), bounds, stop.signal, () => undefined)).rejects.toThrow('cancelled');
});
