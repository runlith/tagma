import { afterAll } from 'bun:test';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { writeDiagnostic } from '@runlith/testbed/fixture';

const out = process.env['GIT_SITES_OUT'];
if (out === undefined || !out.startsWith('/')) throw new Error('git-sites: set GIT_SITES_OUT to an absolute directory');

const REPO = resolve(import.meta.dir, '../../../..');
const SOURCES = [join(REPO, 'apps/'), join(REPO, 'packages/')];
const rows: string[] = [];

type Frame = { readonly name: string; readonly at: string };
type SpanLike = { readonly name: string; readonly spanId: string; readonly parent?: { readonly _tag: string; readonly value?: SpanLike } };
type StackFrame = { readonly name: string; readonly stack: () => string | undefined; readonly parent?: unknown };
type FiberLike = { readonly currentSpanLocal?: SpanLike; readonly context?: { readonly mapUnsafe?: ReadonlyMap<string, unknown> } };

const PAIRED = new Set(['worktree', 'config', 'cat-file', 'stash', 'remote', 'notes', 'submodule']);

const verbOf = (args: readonly string[]): string => {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '-C' || arg === '-c' || arg === '--git-dir' || arg === '--work-tree') at += 1;
    else if (!arg.startsWith('-')) {
      const next = args[at + 1];
      return PAIRED.has(arg) && next !== undefined ? `${arg} ${next}` : arg;
    }
  }
  return '';
};

const siteOf = (line: string | undefined): string => {
  if (line === undefined) return '?';
  const match = /\(?(\/[^\s()]+):(\d+):\d+\)?$/.exec(line.trim());
  return match === null ? line.trim() : `${relative(REPO, match[1]!)}:${match[2]}`;
};

const fiber = (): FiberLike | undefined => (globalThis as Record<string, unknown>)['~effect/Fiber/currentFiber'] as FiberLike | undefined;

const rootOf = (): { readonly id: string; readonly name: string; readonly path: string } | null => {
  let span = fiber()?.currentSpanLocal;
  if (span === undefined) return null;
  const names: string[] = [];
  for (let depth = 0; depth < 200; depth += 1) {
    names.push(span.name);
    const parent: SpanLike | undefined = span.parent?._tag === 'Some' ? span.parent.value : undefined;
    if (parent === undefined || (parent as { readonly _tag?: string })._tag === 'ExternalSpan') break;
    span = parent;
  }
  return { id: span.spanId, name: span.name, path: names.reverse().slice(0, 12).join(' > ') };
};

const effectFrames = (): Frame[] | undefined => {
  const current = fiber();
  if (current === undefined) return undefined;
  const frames: Frame[] = [];
  let frame = current.context?.mapUnsafe?.get('effect/References/CurrentStackFrame') as StackFrame | undefined;
  while (frame !== undefined && frames.length < 40) {
    frames.push({ name: frame.name, at: siteOf(frame.stack()) });
    frame = frame.parent as StackFrame | undefined;
  }
  return frames;
};

const jsFrames = (): string[] =>
  (new Error().stack ?? '')
    .split('\n')
    .slice(2)
    .filter((line) => SOURCES.some((source) => line.includes(source)) && !line.includes('node_modules'))
    .slice(0, 8)
    .map(siteOf);

const cwdOf = (options: unknown): string => {
  const cwd = typeof options === 'object' && options !== null ? (options as { readonly cwd?: unknown }).cwd : undefined;
  return resolve(cwd instanceof URL ? cwd.pathname : typeof cwd === 'string' ? cwd : process.cwd());
};

const record = (command: unknown, args: readonly unknown[], options: unknown): void => {
  if (String(command).split('/').pop() !== 'git') return;
  const argv = args.map(String);
  const frames = effectFrames();
  rows.push(
    JSON.stringify({
      file: relative(REPO, Bun.main),
      verb: verbOf(argv),
      argv,
      cwd: cwdOf(options),
      root: frames === undefined ? null : rootOf(),
      frames: frames ?? null,
      js: frames === undefined || frames.length === 0 ? jsFrames() : undefined,
    }),
  );
};

let inside = 0;
const childProcess = createRequire(import.meta.url)('node:child_process') as Record<string, (...args: unknown[]) => unknown>;
for (const name of ['spawn', 'execFile', 'spawnSync', 'execFileSync']) {
  const original = childProcess[name]!;
  childProcess[name] = (...args: unknown[]) => {
    if (inside === 0) {
      const listed = Array.isArray(args[1]);
      record(args[0], listed ? (args[1] as unknown[]) : [], listed ? args[2] : args[1]);
    }
    inside += 1;
    try {
      return original(...args);
    } finally {
      inside -= 1;
    }
  };
}

const bun = Bun as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ['spawn', 'spawnSync']) {
  const original = bun[name]!;
  bun[name] = (...args: unknown[]) => {
    const first = args[0];
    const argv = (Array.isArray(first) ? first : (first as { readonly cmd: readonly unknown[] }).cmd) as readonly unknown[];
    if (inside === 0) record(argv[0], argv.slice(1), Array.isArray(first) ? args[1] : first);
    return original(...args);
  };
}

afterAll(() => {
  if (rows.length === 0) return;
  const path = join(out, `git-sites.${process.pid}.${Date.now()}.jsonl`);
  writeDiagnostic(path, `${rows.join('\n')}\n`);
  console.error(`git-sites: ${path}`);
  rows.length = 0;
});
