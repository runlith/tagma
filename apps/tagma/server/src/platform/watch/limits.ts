import { readFile, readdir } from 'node:fs/promises';
import { Effect } from 'effect';
import { dlopen } from 'bun:ffi';

export type WatchLimits = {
  readonly soft: number;
  readonly opened: number;
  readonly inotify: number | null;
};

export const watchBudget = ({ soft, opened, inotify }: WatchLimits): number => {
  if (!Number.isSafeInteger(soft) || !Number.isSafeInteger(opened) || soft < 1 || opened < 0) return 0;
  if (inotify !== null && (!Number.isSafeInteger(inotify) || inotify < 1)) return 0;
  return Math.max(0, Math.min(Math.floor(soft * 0.8) - opened, inotify ?? Number.MAX_SAFE_INTEGER));
};

type LimitApi = {
  readonly getrlimit: (resource: number, target: Buffer) => number;
  readonly setrlimit: (resource: number, target: Buffer) => number;
};

const TARGETS: Partial<
  Record<NodeJS.Platform, { readonly resource: number; readonly libraries: readonly string[]; readonly descriptors: string }>
> = {
  darwin: { resource: 8, libraries: ['libc.dylib'], descriptors: '/dev/fd' },
  linux: {
    resource: 7,
    libraries: ['libc.so.6', `libc.musl-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`],
    descriptors: '/proc/self/fd',
  },
};

const apiOf = (libraries: readonly string[]): LimitApi | null => {
  for (const library of libraries) {
    try {
      const { symbols } = dlopen(library, {
        getrlimit: { args: ['i32', 'ptr'], returns: 'i32' },
        setrlimit: { args: ['i32', 'ptr'], returns: 'i32' },
      });
      return {
        getrlimit: (resource, target) => symbols.getrlimit(resource, target) as number,
        setrlimit: (resource, target) => symbols.setrlimit(resource, target) as number,
      };
    } catch {
      continue;
    }
  }
  return null;
};

const finite = (limit: bigint): number => (limit > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(limit));

const nofile = (resource: number, api: LimitApi): number => {
  const current = Buffer.alloc(16);
  if (api.getrlimit(resource, current) !== 0) return 0;
  const soft = current.readBigUInt64LE(0);
  const hard = current.readBigUInt64LE(8);
  const raised = BigInt(Math.min(finite(hard), 65_536));
  if (soft < raised) {
    const proposed = Buffer.alloc(16);
    proposed.writeBigUInt64LE(raised, 0);
    proposed.writeBigUInt64LE(hard, 8);
    if (api.setrlimit(resource, proposed) === 0 && api.getrlimit(resource, current) === 0) {
      return finite(current.readBigUInt64LE(0));
    }
  }
  return finite(soft);
};

const numberAt = (path: string): Promise<number> =>
  readFile(path, 'utf8').then(
    (text) => {
      const value = Number(text.trim());
      return Number.isSafeInteger(value) && value > 0 ? value : 0;
    },
    () => 0,
  );

const openedIn = (descriptors: string): Promise<number | null> =>
  readdir(descriptors).then(
    (names) => names.filter((name) => /^\d+$/.test(name)).length,
    () => null,
  );

export const machineWatchLimits: Effect.Effect<WatchLimits> = Effect.promise(async () => {
  const target = TARGETS[process.platform];
  if (target === undefined) return { soft: 0, opened: 0, inotify: null };
  const api = apiOf(target.libraries);
  const soft = api === null ? 0 : nofile(target.resource, api);
  const opened = await openedIn(target.descriptors);
  if (opened === null) return { soft: 0, opened: 0, inotify: null };
  return {
    soft,
    opened,
    inotify: process.platform === 'linux' ? await numberAt('/proc/sys/fs/inotify/max_user_watches') : null,
  };
});
