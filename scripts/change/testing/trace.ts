import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate } from '@runlith/testbed/fixture';

type Entry = { readonly file: string; readonly packages: readonly string[]; readonly files: readonly string[] };
type Audit = {
  readonly root: string;
  readonly report: string;
  readonly runner: 'bun' | 'vitest';
  readonly entries: readonly Entry[];
  readonly importers: readonly { readonly path: string; readonly literal: readonly string[] }[];
};
type Resolved = { readonly roots: readonly string[]; readonly files: ReadonlySet<string> };
type Tracer = {
  readonly runner: 'bun' | 'vitest';
  readonly check: (input: unknown) => void;
  readonly load: (specifier: string, importer: string) => void;
  readonly watching: boolean;
  readonly ours: WeakSet<object>;
};
const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');
const original = Symbol.for('runlith.testbed.original');
const carried = Symbol.for('runlith.change.trace');
const real = <F extends Function>(fn: F): F => (fn as unknown as Record<symbol, F>)[original] ?? fn;

const tracer = (configPath: string): Tracer => {
  const config = JSON.parse(real(fs.readFileSync)(configPath, 'utf8')) as Audit;
  const append = real(fs.appendFileSync);
  const base = fs.realpathSync(config.root);
  const reported = new Set<string>();
  const named = new Map(config.entries.map((entry) => [entry.file, entry]));
  const resolved = new Map<string, Resolved>();
  const entryOf = (file: string): Resolved | undefined => {
    const known = resolved.get(file);
    if (known !== undefined) return known;
    const entry = named.get(file);
    if (entry === undefined) return undefined;
    const fresh = {
      roots: entry.packages.map((dir) => locate(resolve(config.root, dir)).path),
      files: new Set(entry.files.map((path) => locate(resolve(config.root, path)).path)),
    };
    resolved.set(file, fresh);
    return fresh;
  };
  const check = (input: unknown): void => {
    const worker = (globalThis as unknown as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__;
    const file = relative(base, config.runner === 'bun' ? Bun.main : (worker?.filepath ?? ''));
    const entry = entryOf(file);
    if (entry === undefined) return;
    const raw = input instanceof URL ? fileURLToPath(input) : typeof input === 'string' ? input : undefined;
    const location = raw === undefined ? undefined : locate(raw);
    const path = location?.path;
    const inside = (root: string): boolean => path === root || path?.startsWith(`${root}/`) === true;
    if (
      location?.state === 'known' &&
      (entry.files.has(location.path) ||
        entry.roots.some(inside) ||
        location.path.includes('/node_modules/') ||
        location.path === '/dev/null' ||
        location.isolated)
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
  const watched = new Map(config.importers.map(({ path, literal }) => [resolve(base, path), new Set(literal)]));
  const loaded = new Set<string>();
  let resolving = false;
  const load = (specifier: string, importer: string): void => {
    if (resolving || watched.get(importer)?.has(specifier) !== false) return;
    resolving = true;
    let target: string;
    try {
      target = Bun.resolveSync(specifier, dirname(importer));
    } catch {
      return;
    } finally {
      resolving = false;
    }
    const to = relative(base, target);
    const key = `${Bun.main}\0${importer}\0${to}`;
    if (!isAbsolute(target) || to.startsWith('..') || to.includes('node_modules/') || loaded.has(key)) return;
    loaded.add(key);
    const row = { type: 'load', file: relative(base, Bun.main), importer: relative(base, importer), target: to };
    append(config.report, `${JSON.stringify(row)}\n`);
  };
  return { runner: config.runner, check, load, watching: watched.size > 0, ours: new WeakSet() };
};

const wrap = (trace: Tracer, object: Record<string, unknown>, names: readonly string[]): void => {
  for (const name of names) {
    const fn = object[name];
    if (typeof fn !== 'function' || trace.ours.has(fn)) continue;
    const wrapper = Object.assign(
      function (this: unknown, ...args: unknown[]) {
        const flags = args[1];
        const writing =
          (name === 'open' || name === 'openSync') &&
          (typeof flags === 'string' ? !flags.startsWith('r') && !flags.includes('+') : typeof flags === 'number' && (flags & 3) === 1);
        if (!writing) trace.check(args[0]);
        return Reflect.apply(fn, this, args);
      },
      { [original]: real(fn) },
    );
    trace.ours.add(wrapper);
    object[name] = wrapper;
  }
};

const configPath = process.env['RUNLITH_CHANGE_AUDIT'];
if (configPath !== undefined) {
  const carrier = globalThis as unknown as Record<symbol, Tracer | undefined>;
  const trace = (carrier[carried] ??= tracer(configPath));
  const calls = ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream', 'readdir', 'readdirSync', 'readlink', 'readlinkSync'];
  wrap(trace, fs as unknown as Record<string, unknown>, calls);
  wrap(trace, fs.promises as unknown as Record<string, unknown>, ['readFile', 'open', 'readdir', 'readlink']);
  if (!trace.ours.has(Bun.file)) {
    const file = Bun.file;
    const traced = ((...args: Parameters<typeof Bun.file>) => {
      trace.check(args[0]);
      return file(...args);
    }) as typeof Bun.file;
    trace.ours.add(traced);
    Bun.file = traced;
  }
  if (trace.runner === 'bun') {
    if (trace.watching && !trace.ours.has(trace.load)) {
      trace.ours.add(trace.load);
      Bun.plugin({
        name: 'change-loads',
        setup: (build) => {
          build.onResolve({ filter: /.*/ }, (args) => {
            trace.load(args.path, args.importer);
            return undefined;
          });
        },
      });
    }
    const { mock } = await import('bun:test');
    for (const specifier of ['fs', 'node:fs']) mock.module(specifier, () => ({ ...fs, default: fs }));
    for (const specifier of ['fs/promises', 'node:fs/promises']) mock.module(specifier, () => ({ ...fs.promises, default: fs.promises }));
  } else {
    const { vi } = await import('vitest');
    for (const specifier of ['fs', 'node:fs']) vi.doMock(specifier, () => ({ ...fs, default: fs }));
    for (const specifier of ['fs/promises', 'node:fs/promises']) vi.doMock(specifier, () => ({ ...fs.promises, default: fs.promises }));
  }
}
