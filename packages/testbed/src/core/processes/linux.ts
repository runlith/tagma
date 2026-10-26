import { createRequire } from 'node:module';
import { MARK, marksIn, type Facts, type Processes, type Row } from '../processes.ts';

const TICKS_PER_SECOND = 100;
const TICKS_PER_MS = TICKS_PER_SECOND / 1000;
const MARKED = `${MARK}=`;

type Fs = typeof import('node:fs');

export const linux = async (bun: boolean): Promise<Processes> => {
  const fs = createRequire(import.meta.url)('node:fs') as Fs;
  const read = (path: string): string | undefined => {
    try {
      return fs.readFileSync(path, 'latin1');
    } catch {
      return undefined;
    }
  };
  const stat = (pid: number): string[] | undefined => {
    const line = read(`/proc/${pid}/stat`);
    return line === undefined ? undefined : line.slice(line.lastIndexOf(')') + 2).split(' ');
  };
  const facts = (pid: number): Facts | undefined => {
    const fields = stat(pid);
    if (fields === undefined) return undefined;
    const line = read(`/proc/${pid}/comm`) ?? '';
    return {
      pid,
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      zombie: fields[0] === 'Z',
      start: Number(fields[19]),
      name: line.trim(),
    };
  };
  const pids = (): number[] =>
    fs
      .readdirSync('/proc')
      .filter((entry) => /^\d+$/.test(entry))
      .map(Number);
  const reaped = bun ? await rusage() : () => undefined;
  const marked = (known: Facts): Row => {
    const mark = read(`/proc/${known.pid}/environ`)
      ?.split('\0')
      .find((pair) => pair.startsWith(MARKED))
      ?.slice(MARKED.length);
    return { ...known, marks: marksIn(mark) };
  };
  const select = (keep: (known: Facts) => boolean): Row[] =>
    pids().flatMap((pid) => {
      const known = facts(pid);
      return known === undefined || !keep(known) ? [] : [marked(known)];
    });
  return {
    facts,
    rows: (scope) => {
      const groups = scope === 'all' ? undefined : new Set(scope);
      return select((known) => groups === undefined || groups.has(known.pgid));
    },
    clock: () => Number(read('/proc/uptime')?.split(' ')[0] ?? 0) * TICKS_PER_SECOND,
    born: (since) => select((known) => known.start >= since),
    children: (pid) =>
      pids().filter((child) => {
        const known = facts(child);
        return known !== undefined && known.ppid === pid && !known.zombie;
      }),
    cwds: (pids) => {
      const found = new Map<number, string>();
      for (const pid of pids) {
        try {
          found.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`));
        } catch {}
      }
      return found;
    },
    command: (pid) => read(`/proc/${pid}/cmdline`)?.replaceAll('\0', ' ').trim(),
    cpu: (pid) => {
      const fields = stat(pid);
      return fields === undefined ? undefined : (Number(fields[11]) + Number(fields[12])) / TICKS_PER_MS;
    },
    reaped,
  };
};

const rusage = async (): Promise<() => number> => {
  const { dlopen, FFIType, suffix } = await import('bun:ffi');
  const lib = dlopen(`libc.${suffix}.6`, { getrusage: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } }).symbols;
  const usage = new BigInt64Array(18);
  return () => {
    lib.getrusage(-1, usage);
    return Number(usage[0]! + usage[2]!) * 1000 + Number(usage[1]! + usage[3]!) / 1000;
  };
};
