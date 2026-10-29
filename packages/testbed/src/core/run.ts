import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, sep } from 'node:path';
import { pristine } from './pristine.ts';
import { MARK, type Processes } from './processes.ts';
import { runLiveness as ownerLiveness, sweep, type RunLiveness } from './watch.ts';

export const BASE = join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'runlith-test');
export const REPORTS = join(BASE, 'reports');
export const ROOT_ENV = 'RUNLITH_TEST_RUN_ROOT';
export const REPORT_ENV = 'RUNLITH_TEST_REPORT';
const KEPT_REPORTS = 40;

type Fs = typeof import('node:fs');

export const fs = (): Fs => createRequire(import.meta.url)('node:fs') as Fs;

const roots = new Set<string>();
const lstat = pristine(fs().lstatSync);
const readlink = pristine(fs().readlinkSync);
const HOMES = Symbol.for('runlith.testbed.worldHomes');

const append = (parent: string, child: string): string => `${parent}${parent.endsWith(sep) ? '' : sep}${child}`;

const canonical = (path: string): string => {
  let at = parse(path).root;
  let parts = path.slice(at.length).split(sep);
  let links = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part === '' || part === '.') continue;
    if (part === '..') {
      at = dirname(at);
      continue;
    }
    const next = append(at, part);
    const info = lstat(next, { throwIfNoEntry: false });
    if (info === undefined) return index + 1 === parts.length ? next : append(next, parts.slice(index + 1).join(sep));
    if (info.isSymbolicLink()) {
      if (++links > 40) throw Object.assign(new Error('Too many symbolic links'), { code: 'ELOOP' });
      const target = readlink(next);
      const root = parse(target).root;
      if (isAbsolute(target)) at = root;
      parts = [...target.slice(root.length).split(sep), ...parts.slice(index + 1)];
      index = -1;
    } else at = next;
  }
  return at;
};

const remember = (path: string): string => {
  roots.add(canonical(path));
  return path;
};

export const worldHome = (): string => {
  const carrier = globalThis as unknown as Record<symbol, number | undefined>;
  const exists = pristine(fs().existsSync);
  for (;;) {
    const home = join(BASE, `${process.pid}.w${(carrier[HOMES] = (carrier[HOMES] ?? 0) + 1)}`);
    if (!exists(home)) return remember(home);
  }
};

export type PathLocation =
  | { readonly state: 'known'; readonly path: string; readonly isolated: boolean }
  | { readonly state: 'unresolved'; readonly path: string; readonly code: string };

export const locate = (path: string): PathLocation => {
  const absolute = isAbsolute(path) ? path : append(process.cwd(), path);
  let actual: string;
  try {
    actual = canonical(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code !== 'string') throw error;
    return { state: 'unresolved', path: absolute, code };
  }
  for (let at = actual; ; at = dirname(at)) {
    if (roots.has(at)) return { state: 'known', path: actual, isolated: true };
    if (dirname(at) === at) return { state: 'known', path: actual, isolated: false };
  }
};

export type Run = { readonly root: string; readonly report: string; readonly fresh: boolean };

export const ownerName = (pid: number, start: number): string => `run.${pid}.${Math.round(start * 1000)}`;

export const openRun = (owner: { readonly pid: number; readonly start: number } | undefined): Run => {
  delete process.env['BUN_FEATURE_FLAG_NO_ORPHANS'];
  const files = fs();
  const given = process.env[ROOT_ENV];
  pristine(files.mkdirSync)(REPORTS, { recursive: true });
  if (given !== undefined && given !== '' && files.existsSync(given)) {
    return { root: remember(given), report: process.env[REPORT_ENV] || join(REPORTS, `${basename(given)}.jsonl`), fresh: false };
  }
  const name = owner === undefined ? `run.${process.pid}.${randomUUID().slice(0, 8)}` : ownerName(owner.pid, owner.start);
  const root = join(BASE, name);
  let fresh = true;
  try {
    pristine(files.mkdirSync)(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    fresh = false;
  }
  return { root: remember(root), report: process.env[REPORT_ENV] || join(REPORTS, `${name}.jsonl`), fresh };
};

export const runLiveness = (processes: Processes, root: string): RunLiveness => ownerLiveness(processes, basename(root));

export const sweepRuns = (processes: Processes): { readonly stranded: number; readonly roots: number } => {
  const files = fs();
  const entries = files.readdirSync(BASE).filter((entry) => /^(?:run\.)?\d+\./.test(entry));
  const swept = sweep(processes, BASE, entries);
  for (const root of swept.roots) {
    const claimed = join(BASE, `${process.pid}.swept.${randomUUID().slice(0, 8)}`);
    try {
      pristine(files.renameSync)(root, claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    pristine(files.rmSync)(claimed, { recursive: true, force: true });
  }
  const ended = new Set(swept.roots.map((root) => basename(root)));
  const reports = files
    .readdirSync(REPORTS)
    .filter((entry) => entry.endsWith('.jsonl'))
    .filter((entry) => ended.has(entry.replace(/\.jsonl$/, '')) || !files.existsSync(join(BASE, entry.replace(/\.jsonl$/, ''))))
    .flatMap((entry) => {
      const found = files.statSync(join(REPORTS, entry), { throwIfNoEntry: false });
      return found === undefined || !found.isFile() ? [] : [{ path: join(REPORTS, entry), at: found.mtimeMs }];
    })
    .sort((left, right) => right.at - left.at);
  for (const old of reports.slice(KEPT_REPORTS)) {
    const claimed = join(BASE, `${process.pid}.swept.${randomUUID().slice(0, 8)}`);
    try {
      pristine(files.renameSync)(old.path.replace(/\.jsonl$/, ''), claimed);
      pristine(files.rmSync)(claimed, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    pristine(files.rmSync)(old.path, { force: true });
  }
  return { stranded: swept.stranded, roots: swept.roots.length };
};

const REAL = Symbol.for('runlith.testbed.environment');

const SELECTED_DEVELOPER = '/var/db/xcode_select_link';
const DEVELOPER_DEFAULTS = ['/Applications/Xcode.app/Contents/Developer', '/Library/Developer/CommandLineTools'] as const;
let developerBin: string | null | undefined;

const developerTools = (files: Fs, real: Record<string, string | undefined>): string | null => {
  if (developerBin !== undefined) return developerBin;
  developerBin = null;
  if (process.platform !== 'darwin') return developerBin;
  const exists = pristine(files.existsSync);
  const resolved = (real['PATH'] ?? '').split(':').find((dir) => dir !== '' && exists(join(dir, 'git')));
  if (resolved !== '/usr/bin') return developerBin;
  const selected = real['DEVELOPER_DIR'] || (exists(SELECTED_DEVELOPER) ? readlink(SELECTED_DEVELOPER) : undefined);
  const homes = selected === undefined ? DEVELOPER_DEFAULTS : [selected];
  developerBin = homes.map((home) => join(home, 'usr', 'bin')).find((bin) => exists(join(bin, 'git'))) ?? null;
  return developerBin;
};

const throughDeveloperTools = (path: string, bin: string): string => {
  const dirs = path.split(':');
  const shims = dirs.indexOf('/usr/bin');
  return [...dirs.slice(0, shims), bin, ...dirs.slice(shims)].join(':');
};

export type Confined = {
  readonly root: string;
  readonly token: string;
  readonly seen: () => void;
  readonly retire: () => string | undefined;
};

export const confine = (): Confined => {
  const files = fs();
  const env = process.env;
  const carrier = globalThis as unknown as Record<symbol, Record<string, string | undefined> | undefined>;
  const real = (carrier[REAL] ??= { ...env });
  const token = `${process.pid}.${randomUUID().slice(0, 8)}`;
  const root = join(BASE, token);
  const home = join(root, 'home');
  const gitconfig = join(root, 'gitconfig');
  pristine(files.mkdirSync)(home, { recursive: true });
  remember(root);
  pristine(files.writeFileSync)(join(home, '.claude.json'), JSON.stringify({ userID: randomUUID() }));
  pristine(files.writeFileSync)(
    gitconfig,
    '[user]\n\tname = runlith test\n\temail = test@runlith.invalid\n[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n',
  );
  const realHome = real['HOME'] ?? '';
  env['BUN_INSTALL_CACHE_DIR'] = real['BUN_INSTALL_CACHE_DIR'] ?? join(real['BUN_INSTALL'] ?? join(realHome, '.bun'), 'install', 'cache');
  if (process.platform !== 'win32') {
    env['BUN_RUNTIME_TRANSPILER_CACHE_PATH'] =
      real['BUN_RUNTIME_TRANSPILER_CACHE_PATH'] ??
      join(real['XDG_CACHE_HOME'] ?? join(realHome, process.platform === 'darwin' ? join('Library', 'Caches') : '.cache'), 'bun', '@t@');
  }
  env['DOCKER_CONFIG'] = real['DOCKER_CONFIG'] ?? join(realHome, '.docker');
  env['RUSTUP_HOME'] = real['RUSTUP_HOME'] ?? join(realHome, '.rustup');
  env['CARGO_HOME'] = real['CARGO_HOME'] ?? join(realHome, '.cargo');
  env['TAGMA_BROWSER_BUILDS'] = real['TAGMA_BROWSER_BUILDS'] ?? join(realHome, '.cache', 'runlith', 'browser-builds');
  env['PLAYWRIGHT_BROWSERS_PATH'] =
    real['PLAYWRIGHT_BROWSERS_PATH'] ??
    (process.platform === 'darwin'
      ? join(realHome, 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32'
        ? join(real['LOCALAPPDATA'] ?? join(realHome, 'AppData', 'Local'), 'ms-playwright')
        : join(real['XDG_CACHE_HOME'] ?? join(realHome, '.cache'), 'ms-playwright'));
  env['TAGMA_SEED_DIRECTORY'] = real['TAGMA_SEED_DIRECTORY'] || join(BASE, 'seed');
  env['GIT_CONFIG_NOSYSTEM'] = '1';
  env['HOME'] = home;
  env['XDG_CONFIG_HOME'] = join(home, '.config');
  env['XDG_DATA_HOME'] = join(home, '.local', 'share');
  env['XDG_STATE_HOME'] = join(home, '.local', 'state');
  env['XDG_CACHE_HOME'] = join(home, '.cache');
  env['GIT_CONFIG_GLOBAL'] = gitconfig;
  const tools = developerTools(files, real);
  if (tools !== null) env['PATH'] = throughDeveloperTools(real['PATH'] ?? '', tools);
  env['TMPDIR'] = root;
  env[MARK] = real[MARK] === undefined || real[MARK] === '' ? token : `${real[MARK]}:${token}`;
  delete env[ROOT_ENV];
  delete env[REPORT_ENV];
  const listed = (): string[] => pristine(files.readdirSync)(root);
  let known = new Set(listed());
  return {
    root,
    token,
    seen: () => {
      known = new Set(listed());
    },
    retire: () => {
      const remove = pristine(files.rmSync);
      const arrived = listed().filter((entry) => !known.has(entry));
      if (arrived.length === 0) remove(root, { recursive: true, force: true });
      else for (const entry of known) remove(join(root, entry), { recursive: true, force: true });
      for (const key of Object.keys(env)) if (!(key in real)) delete env[key];
      Object.assign(env, real);
      return arrived.length === 0 ? undefined : root;
    },
  };
};
