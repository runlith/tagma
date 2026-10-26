import { createRequire } from 'node:module';
import { ORIGINAL, quiet, quietly } from './pristine.ts';

export type Resource = 'process' | 'sqlite' | 'socket' | 'write';

export type Reach = { readonly resource: Resource; readonly external?: string };

export interface GuardHooks {
  readonly reach: (reach: Reach, via: string) => void;
  readonly process: <T>(via: string, args: readonly unknown[], sync: boolean, run: () => T) => T;
  readonly expose: (specifiers: readonly string[], object: Record<string, unknown>, fallback?: unknown) => void;
}

type Classify = (args: readonly unknown[], self: unknown) => Reach | undefined;
type Prepare = (args: unknown[]) => unknown[];
type Options = { readonly prepare?: Prepare; readonly process?: 'async' | 'sync' };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);
const SQLITE_CHILD = /\/sqlite-process\/src\/child\.[jt]s$/;

const FS_WRITES = [
  'writeFile',
  'appendFile',
  'mkdir',
  'mkdtemp',
  'rm',
  'rmdir',
  'unlink',
  'rename',
  'copyFile',
  'cp',
  'symlink',
  'link',
  'truncate',
  'chmod',
  'lchmod',
  'chown',
  'lchown',
  'utimes',
  'lutimes',
];

export const isLocal = (host: string | undefined): boolean => {
  if (host === undefined || host === '') return false;
  if (LOOPBACK.has(host)) return true;
  const bare = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  return LOOPBACK.has(bare);
};

const reaching = (host: string | undefined, what: string): Reach =>
  host === undefined || isLocal(host) ? { resource: 'socket' } : { resource: 'socket', external: `${what} ${host}` };

const connecting: Classify = ([first, second]) => {
  if (first !== null && typeof first === 'object') {
    const target = first as { host?: string; hostname?: string; path?: string; unix?: string };
    return target.path !== undefined || target.unix !== undefined
      ? { resource: 'socket' }
      : reaching(target.host ?? target.hostname, 'connection to');
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return reaching(typeof second === 'string' ? second : undefined, 'connection to');
  }
  return { resource: 'socket' };
};

const websocket: Classify = ([url]) => {
  try {
    return reaching(new URL(urlOf(url)).host, 'websocket to');
  } catch {
    return { resource: 'socket' };
  }
};

export const urlOf = (input: unknown): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as { url?: unknown } | undefined)?.url);

const offline = (url: string): boolean => {
  try {
    return ['data:', 'blob:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const fetching: Classify = ([input]) => {
  const url = urlOf(input);
  if (offline(url)) return undefined;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return { resource: 'socket' };
  }
  return isLocal(host) ? { resource: 'socket' } : { resource: 'socket', external: `fetch ${url}` };
};

const requesting =
  (scheme: string): Classify =>
  ([first]) => {
    const host =
      typeof first === 'string' || first instanceof URL
        ? new URL(String(first)).host
        : ((first as { host?: string } | undefined)?.host ?? (first as { hostname?: string } | undefined)?.hostname);
    return isLocal(host) ? { resource: 'socket' } : { resource: 'socket', external: `${scheme} request to ${host ?? 'an unnamed host'}` };
  };

const onDisk = (file: unknown): Reach | undefined =>
  typeof file === 'number' || (file instanceof Blob && typeof (file as { name?: unknown }).name !== 'string')
    ? undefined
    : { resource: 'write' };

const withSync = (names: readonly string[]): string[] => names.flatMap((name) => [name, `${name}Sync`]);

const always =
  (resource: Resource): Classify =>
  () => ({ resource });

const withEnvironment: Prepare = (args) => {
  const [first, second, ...rest] = args;
  const current = () => ({ ...process.env });
  if (Array.isArray(first)) {
    const options = (second ?? {}) as { env?: unknown };
    return options.env === undefined ? [first, { ...options, env: current() }, ...rest] : args;
  }
  if (first !== null && typeof first === 'object' && (first as { env?: unknown }).env === undefined) {
    return [{ ...first, env: current() }, ...args.slice(1)];
  }
  return args;
};

const spawning: Classify = ([first]) => {
  const command = Array.isArray(first) ? first : (first as { cmd?: unknown } | undefined)?.cmd;
  return { resource: Array.isArray(command) && command.some((part) => SQLITE_CHILD.test(String(part))) ? 'sqlite' : 'process' };
};

export const installGuards = (hooks: GuardHooks): void => {
  const required = createRequire(import.meta.url);

  const guard = <F extends object>(target: F, classify: Classify, via: string, options: Options): F => {
    const original = ((target as Record<symbol, unknown>)[ORIGINAL] ?? target) as F & ((...args: unknown[]) => unknown);
    const call = (run: () => unknown, args: readonly unknown[]): unknown =>
      options.process === undefined ? run() : hooks.process(via, args, options.process === 'sync', run);
    const guarded: F = new Proxy(original, {
      apply(fn, self, args) {
        if (quiet()) return Reflect.apply(fn, self, args);
        const reach = classify(args, self);
        if (reach !== undefined) hooks.reach(reach, via);
        return quietly(() => call(() => Reflect.apply(fn, self, options.prepare === undefined ? args : options.prepare(args)), args));
      },
      construct(fn, args, newTarget) {
        if (quiet()) return Reflect.construct(fn, args, newTarget === guarded ? fn : newTarget);
        const reach = classify(args, undefined);
        if (reach !== undefined) hooks.reach(reach, via);
        return quietly(() => Reflect.construct(fn, args, newTarget === guarded ? fn : newTarget));
      },
      get(fn, key) {
        return key === ORIGINAL ? fn : Reflect.get(fn, key, fn);
      },
    });
    return guarded;
  };

  const patch = (object: Record<string, unknown>, names: readonly string[], classify: Classify, options: Options = {}): void => {
    for (const name of names) {
      const found = object[name];
      if (typeof found !== 'function') continue;
      try {
        object[name] = guard(found, classify, name, options);
      } catch {}
    }
  };

  const fs = required('node:fs') as Record<string, unknown> & { constants: Record<string, number> };
  const { O_WRONLY = 1, O_RDWR = 2, O_CREAT = 0, O_TRUNC = 0, O_APPEND = 0 } = fs.constants;
  const writing = O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND;
  const opening: Classify = ([, flags]) =>
    (typeof flags === 'number' && (flags & writing) !== 0) || (typeof flags === 'string' && /[wa+]/.test(flags))
      ? { resource: 'write' }
      : undefined;
  patch(fs, [...withSync(FS_WRITES), 'createWriteStream'], ([target]) => onDisk(target));
  patch(fs, ['open', 'openSync'], opening);
  const promises = required('node:fs/promises') as Record<string, unknown>;
  patch(promises, FS_WRITES, ([target]) => onDisk(target));
  patch(promises, ['open'], opening);
  hooks.expose(['node:fs', 'fs'], fs);
  hooks.expose(['node:fs/promises', 'fs/promises'], promises);

  const childProcess = required('node:child_process') as Record<string, unknown>;
  patch(childProcess, ['spawn', 'exec', 'execFile', 'fork'], always('process'), { process: 'async' });
  patch(childProcess, ['spawnSync', 'execSync', 'execFileSync'], always('process'), { process: 'sync' });
  hooks.expose(['node:child_process', 'child_process'], childProcess);

  const net = required('node:net') as Record<string, unknown>;
  patch(net, ['createServer', 'Socket', 'Server'], always('socket'));
  patch(net, ['createConnection', 'connect'], connecting);
  hooks.expose(['node:net', 'net'], net);
  const tls = required('node:tls') as Record<string, unknown>;
  patch(tls, ['createServer'], always('socket'));
  patch(tls, ['connect'], connecting);
  hooks.expose(['node:tls', 'tls'], tls);
  for (const name of ['http', 'https'] as const) {
    const web = required(`node:${name}`) as Record<string, unknown>;
    patch(web, ['createServer'], always('socket'));
    patch(web, ['request', 'get'], requesting(name));
    hooks.expose([`node:${name}`, name], web);
  }
  const dgram = required('node:dgram') as Record<string, unknown>;
  patch(dgram, ['createSocket'], always('socket'));
  hooks.expose(['node:dgram', 'dgram'], dgram);

  try {
    const nodeSqlite = required('node:sqlite') as Record<string, unknown>;
    patch(nodeSqlite, ['DatabaseSync'], always('sqlite'));
    hooks.expose(['node:sqlite'], nodeSqlite);
  } catch {}

  const global = globalThis as unknown as Record<string, unknown>;
  patch(global, ['fetch'], fetching);
  patch(global, ['WebSocket'], websocket);

  if (typeof Bun === 'undefined') return;
  const sqlite = required('bun:sqlite') as Record<string, unknown>;
  const database = ((sqlite['Database'] as Record<symbol, unknown>)[ORIGINAL] ?? sqlite['Database']) as Record<string, unknown>;
  patch(database, ['open'], always('sqlite'));
  patch(sqlite, ['Database'], always('sqlite'));
  hooks.expose(['bun:sqlite'], sqlite, sqlite['Database']);
  const bun = Bun as unknown as Record<string, unknown>;
  patch(bun, ['spawn'], spawning, { prepare: withEnvironment, process: 'async' });
  patch(bun, ['spawnSync'], spawning, { prepare: withEnvironment, process: 'sync' });
  patch(bun, ['$'], always('process'), { process: 'async' });
  patch(bun, ['serve', 'listen', 'udpSocket'], always('socket'));
  patch(bun, ['connect'], connecting);
  patch(bun, ['write'], ([destination]) => onDisk(destination));
  patch(Object.getPrototypeOf(Bun.file('/dev/null')) as Record<string, unknown>, ['write', 'writer', 'delete', 'unlink'], (_, self) =>
    onDisk(self),
  );
};
