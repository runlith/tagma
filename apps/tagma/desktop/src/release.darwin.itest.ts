import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { dlopen } from 'bun:ffi';
import { leaseRelease } from './release.js';

let home: string;
beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-window-release-')));
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const libc = dlopen('libc.dylib', { flock: { args: ['i32', 'i32'], returns: 'i32' } });
const taken = (path: string): boolean => {
  const fd = openSync(path, 'r');
  try {
    if (libc.symbols.flock(fd, 2 | 4) !== 0) return true;
    libc.symbols.flock(fd, 8);
    return false;
  } finally {
    closeSync(fd);
  }
};

test('the window holds a lease on its release directory for as long as it lives', async () => {
  const root = join(home, 'install', '0.1.0');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'bun'), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o700 });

  const holder = await leaseRelease(root, { PATH: process.env.PATH ?? '/usr/bin:/bin' });
  expect(taken(root)).toBe(true);

  const exited = new Promise((left) => holder.once('exit', left));
  holder.stdin?.end();
  await exited;
  expect(taken(root)).toBe(false);
});
