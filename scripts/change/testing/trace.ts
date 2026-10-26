import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate } from '@runlith/testbed/fixture';

type Entry = { readonly file: string; readonly packages: readonly string[]; readonly files: readonly string[] };
type Audit = { readonly root: string; readonly report: string; readonly runner: 'bun' | 'vitest'; readonly entries: readonly Entry[] };
const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const original = Symbol.for('runlith.testbed.original');
const real = <F extends Function>(fn: F): F => (fn as unknown as Record<symbol, F>)[original] ?? fn;
const configPath = process.env['RUNLITH_CHANGE_AUDIT'];
if (configPath !== undefined) {
  const config = JSON.parse(real(fs.readFileSync)(configPath, 'utf8')) as Audit;
  const append = real(fs.appendFileSync);
  const reported = new Set<string>();
  const entries = new Map(
    config.entries.map((entry) => [
      entry.file,
      {
        roots: entry.packages.map((dir) => locate(resolve(config.root, dir)).path),
        files: new Set(entry.files.map((file) => locate(resolve(config.root, file)).path)),
      },
    ]),
  );
  const check = (input: unknown): void => {
    const worker = (globalThis as unknown as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__;
    const file = relative(config.root, config.runner === 'bun' ? Bun.main : (worker?.filepath ?? ''));
    const entry = entries.get(file);
    if (entry === undefined) return;
    const raw = input instanceof URL ? fileURLToPath(input) : typeof input === 'string' ? input : undefined;
    const location = raw === undefined ? undefined : locate(raw);
    const path = location?.path;
    const inside = (root: string): boolean => path === root || path?.startsWith(`${root}/`) === true;
    if (
      location?.state === 'known' &&
      (entry.files.has(location.path) || entry.roots.some(inside) || location.path.includes('/node_modules/') || location.isolated)
    )
      return;
    const reason =
      location === undefined
        ? 'read through an unnamed external input'
        : location.state === 'unresolved'
          ? `unresolved input path (${location.code}): ${location.path}`
          : `read outside hashed packages: ${location.path}`;
    const key = `${file}\0${reason}`;
    if (!reported.has(key)) {
      reported.add(key);
      append(config.report, `${JSON.stringify({ type: 'input', file, reason })}\n`);
    }
  };
  const wrap = (object: Record<string, unknown>, names: readonly string[]): void => {
    for (const name of names) {
      const fn = object[name];
      if (typeof fn !== 'function') continue;
      object[name] = Object.assign(
        function (this: unknown, ...args: unknown[]) {
          const flags = args[1];
          const writing =
            (name === 'open' || name === 'openSync') &&
            (typeof flags === 'string' ? !flags.startsWith('r') && !flags.includes('+') : typeof flags === 'number' && (flags & 3) === 1);
          if (!writing) check(args[0]);
          return Reflect.apply(fn, this, args);
        },
        { [original]: real(fn) },
      );
    }
  };
  const calls = ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'readdir', 'readdirSync', 'readlink', 'readlinkSync'];
  wrap(fs as unknown as Record<string, unknown>, calls);
  wrap(fs.promises as unknown as Record<string, unknown>, ['readFile', 'open', 'readdir', 'readlink']);
  const file = Bun.file;
  const tracked = (target: ReturnType<typeof Bun.file>, path: unknown): ReturnType<typeof Bun.file> =>
    new Proxy(target, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (['text', 'json', 'arrayBuffer', 'bytes', 'stream'].includes(String(key))) check(path);
          const result = Reflect.apply(value, target, args);
          return key === 'slice' ? tracked(result as ReturnType<typeof Bun.file>, path) : result;
        };
      },
    });
  Bun.file = ((...args: Parameters<typeof Bun.file>) => tracked(file(...args), args[0])) as typeof Bun.file;
  if (config.runner === 'bun') {
    const { mock } = await import('bun:test');
    for (const specifier of ['fs', 'node:fs']) mock.module(specifier, () => ({ ...fs, default: fs }));
    for (const specifier of ['fs/promises', 'node:fs/promises']) mock.module(specifier, () => ({ ...fs.promises, default: fs.promises }));
  } else {
    const { vi } = await import('vitest');
    for (const specifier of ['fs', 'node:fs']) vi.doMock(specifier, () => ({ ...fs, default: fs }));
    for (const specifier of ['fs/promises', 'node:fs/promises']) vi.doMock(specifier, () => ({ ...fs.promises, default: fs.promises }));
  }
}
