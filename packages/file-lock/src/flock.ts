import { dlopen, read } from 'bun:ffi';

const LOCK_SH = 1;
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
const EINTR = 4;

type Target = {
  readonly libraries: readonly string[];
  readonly unsupported: readonly number[];
  readonly errno: string;
  readonly closeOnExec: number;
  readonly wouldBlock: number;
};

const TARGETS: Partial<Record<NodeJS.Platform, Target>> = {
  darwin: { libraries: ['libc.dylib'], unsupported: [45, 102, 77], errno: '__error', closeOnExec: 0x2000_6601, wouldBlock: 35 },
  linux: {
    libraries: ['libc.so.6', `libc.musl-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}.so.1`],
    unsupported: [95, 37],
    errno: '__errno_location',
    closeOnExec: 0x5451,
    wouldBlock: 11,
  },
};

type Libc = {
  readonly target: Target;
  readonly flock: (fd: number, operation: number) => number;
  readonly ioctl: (fd: number, request: number) => number;
  readonly errno: () => number;
};

let loaded: Libc | undefined;

const libc = (): Libc => {
  if (loaded !== undefined) return loaded;
  const target = TARGETS[process.platform];
  if (target === undefined) throw new Error(`no advisory file lock is available on ${process.platform}`);
  const open = (library: string) =>
    dlopen(library, {
      flock: { args: ['i32', 'i32'], returns: 'i32' },
      ioctl: { args: ['i32', 'u64'], returns: 'i32' },
      [target.errno]: { args: [], returns: 'ptr' },
    });
  let opened: ReturnType<typeof open> | undefined;
  for (const library of target.libraries) {
    try {
      opened = open(library);
      break;
    } catch (cause) {
      if (library === target.libraries.at(-1)) throw cause;
    }
  }
  const { symbols } = opened!;
  const location = symbols[target.errno] as unknown as () => number;
  loaded = {
    target,
    flock: (fd, operation) => symbols.flock(fd, operation) as number,
    ioctl: (fd, request) => symbols.ioctl(fd, request) as number,
    errno: () => read.i32(location() as never, 0),
  };
  return loaded;
};

export type Attempt = 'locked' | 'held';

export function lockExclusive(fd: number): Attempt {
  return attempt(fd, LOCK_EX);
}

export function lockShared(fd: number): Attempt {
  return attempt(fd, LOCK_SH);
}

function attempt(fd: number, operation: number): Attempt {
  const api = libc();
  for (;;) {
    if (api.flock(fd, operation | LOCK_NB) === 0) return 'locked';
    const code = api.errno();
    if (code === EINTR) continue;
    if (code === api.target.wouldBlock) return 'held';
    if (api.target.unsupported.includes(code))
      throw new Error('the filesystem holding the lock file does not support file locks; keep it on a local disk');
    throw new Error(`flock refused the lock with errno ${code}`);
  }
}

export function unlock(fd: number): void {
  const api = libc();
  while (api.flock(fd, LOCK_UN) !== 0) {
    const code = api.errno();
    if (code !== EINTR) throw new Error(`flock refused the unlock with errno ${code}`);
  }
}

export function closeOnExec(fd: number): void {
  const api = libc();
  while (api.ioctl(fd, api.target.closeOnExec) !== 0) {
    const code = api.errno();
    if (code !== EINTR) throw new Error(`the lock handle could not be kept from children: errno ${code}`);
  }
}
