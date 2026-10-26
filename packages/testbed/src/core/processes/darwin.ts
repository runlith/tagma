import { dlopen, FFIType } from 'bun:ffi';
import { MARK, marksIn, type Facts, type Processes, type Row } from '../processes.ts';

const PROC_ALL_PIDS = 1;
const PROC_PGRP_ONLY = 2;
const PROC_PPID_ONLY = 6;
const PROC_PIDTBSDINFO = 3;
const PROC_PIDVNODEPATHINFO = 9;
const RUSAGE_INFO_V0 = 0;
const RUSAGE_CHILDREN = -1;
const SZOMB = 5;
const BSDINFO_SIZE = 136;
const VNODEPATHINFO_SIZE = 2352;
const CWD_OFFSET = 152;
const PATH_MAX = 1024;
const MARKED = `${MARK}=`;

export const darwin = (): Processes => {
  const lib = dlopen('/usr/lib/libSystem.B.dylib', {
    proc_listpids: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    proc_pid_rusage: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    sysctl: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
    getrusage: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    mach_timebase_info: { args: [FFIType.ptr], returns: FFIType.i32 },
  }).symbols;

  const timebase = new Uint32Array(2);
  lib.mach_timebase_info(timebase);
  const ticksToMs = timebase[0]! / timebase[1]! / 1e6;

  const bsd = new Uint8Array(BSDINFO_SIZE);
  const bsdView = new DataView(bsd.buffer);
  const vnode = new Uint8Array(VNODEPATHINFO_SIZE);
  const usage = new BigUint64Array(12);
  const rusage = new BigInt64Array(18);
  let pids = new Int32Array(4096);
  let args: Uint8Array | undefined;
  const latin1 = new TextDecoder('latin1');

  const list = (type: number, info: number): number[] => {
    for (;;) {
      const bytes = lib.proc_listpids(type, info, pids, pids.byteLength);
      if (bytes <= 0) return [];
      const count = bytes / 4;
      if (count < pids.length) return [...pids.subarray(0, count)].filter((pid) => pid > 0);
      pids = new Int32Array(pids.length * 2);
    }
  };

  const text = (bytes: Uint8Array, from: number, length: number): string => {
    const end = bytes.indexOf(0, from);
    return latin1.decode(bytes.subarray(from, end === -1 || end > from + length ? from + length : end));
  };

  const facts = (pid: number): Facts | undefined => {
    if (lib.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, bsd, BSDINFO_SIZE) !== BSDINFO_SIZE) return undefined;
    return {
      pid,
      ppid: bsdView.getUint32(16, true),
      pgid: bsdView.getUint32(100, true),
      zombie: bsdView.getUint32(4, true) === SZOMB,
      start: Number(bsdView.getBigUint64(120, true)) + bsdView.getUint32(128, true) / 1e6,
      name: text(bsd, 48, 16),
    };
  };

  const argumentsOf = (pid: number): { readonly argv: string[]; readonly env: string[] } | undefined => {
    if (args === undefined) {
      const max = new Int32Array(1);
      const size = new BigUint64Array([4n]);
      lib.sysctl(new Int32Array([1, 8]), 2, max, size, null, 0);
      args = new Uint8Array(max[0]! > 0 ? max[0]! : 1 << 20);
    }
    const size = new BigUint64Array([BigInt(args.byteLength)]);
    if (lib.sysctl(new Int32Array([1, 49, pid]), 3, args, size, null, 0) !== 0) return undefined;
    const length = Number(size[0]);
    const argc = new DataView(args.buffer).getInt32(0, true);
    const strings = latin1.decode(args.subarray(4, length)).split('\0');
    let at = 1;
    while (at < strings.length && strings[at] === '') at += 1;
    const argv = strings.slice(at, at + argc);
    const env: string[] = [];
    for (let index = at + argc; index < strings.length && strings[index] !== ''; index += 1) env.push(strings[index]!);
    return { argv, env };
  };

  const marksOf = (pid: number): readonly string[] =>
    marksIn(
      argumentsOf(pid)
        ?.env.find((pair) => pair.startsWith(MARKED))
        ?.slice(MARKED.length),
    );

  const rows = (scope: 'all' | readonly number[]): Row[] => {
    const found = new Set(scope === 'all' ? list(PROC_ALL_PIDS, 0) : scope.flatMap((pgid) => list(PROC_PGRP_ONLY, pgid)));
    const answer: Row[] = [];
    for (const pid of found) {
      const known = facts(pid);
      if (known !== undefined) answer.push({ ...known, marks: known.zombie ? [] : marksOf(pid) });
    }
    return answer;
  };

  return {
    facts,
    rows,
    clock: () => Date.now() / 1000,
    born: (since) => {
      const answer: Row[] = [];
      for (const pid of list(PROC_ALL_PIDS, 0)) {
        const known = facts(pid);
        if (known !== undefined && known.start >= since) answer.push({ ...known, marks: known.zombie ? [] : marksOf(pid) });
      }
      return answer;
    },
    children: (pid) =>
      list(PROC_PPID_ONLY, pid).filter((child) => {
        const known = facts(child);
        return known !== undefined && known.ppid === pid && !known.zombie;
      }),
    cwds: (pids) => {
      const found = new Map<number, string>();
      for (const pid of pids) {
        if (lib.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, vnode, VNODEPATHINFO_SIZE) > 0)
          found.set(pid, text(vnode, CWD_OFFSET, PATH_MAX));
      }
      return found;
    },
    command: (pid) => argumentsOf(pid)?.argv.join(' '),
    cpu: (pid) => (lib.proc_pid_rusage(pid, RUSAGE_INFO_V0, usage) === 0 ? Number(usage[2]! + usage[3]!) * ticksToMs : undefined),
    reaped: () => {
      lib.getrusage(RUSAGE_CHILDREN, rusage);
      return Number(rusage[0]! + rusage[2]!) * 1000 + Number(rusage[1]! + rusage[3]!) / 1000;
    },
  };
};
