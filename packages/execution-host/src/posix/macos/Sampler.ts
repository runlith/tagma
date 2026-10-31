/// <reference types="bun" />

import { constants } from 'node:os';
import type { ProcessCounters, ProcessGpu, UsageDemand, UsageRead } from '../../UsageReader';
import type { ProcessAbi } from './ProcessAbi';
import { baseName, programsOf } from './programs';
import type { NativeCounters, UsageAbi } from './UsageAbi';
import type { RefusedRead, RefusedUsage } from './ps';

type Described = {
  readonly executable: string | undefined;
  readonly invoked: string | undefined;
  readonly command: string | undefined;
  readonly settled: boolean;
};

const COMMAND_CHARS = 240;
//! a child read between fork and exec still shows its parent's program, so its facts are kept only once it has had time to exec
const SETTLED_MS = 2_000;
const REFUSED = new Set([constants.errno.EPERM, constants.errno.EACCES]);
const GPU: ProcessGpu = { _tag: 'Unavailable', reason: 'per-process GPU usage is not measured on this system' };

export class Sampler {
  readonly machineName = 'Mac';
  private described = new Map<string, Described>();

  constructor(
    private readonly usage: UsageAbi,
    private readonly processes: ProcessAbi,
    private readonly refused: RefusedUsage,
  ) {}

  read({ others }: UsageDemand): UsageRead | string {
    const observedAt = Date.now();
    const takenAtMicros = Math.round(performance.now() * 1000);
    const counters = this.usage.all();
    if (!Array.isArray(counters)) return `the native process counters answered errno ${(counters as { readonly errno: number }).errno}`;
    const machine = this.usage.machine();
    const listed = counters as ReadonlyArray<NativeCounters>;
    const refused = others ? listed.filter((row) => REFUSED.has(row.errno)) : [];
    const borrowedRead: RefusedRead = others ? this.refused.read(refused.map((row) => row.pid)) : { read: new Map() };
    const kept = new Set<number>();
    if (borrowedRead.read.size > 0) {
      const after = this.processes.processTable({ _tag: 'Pids', pids: [...borrowedRead.read.keys()] });
      if (Array.isArray(after)) {
        const births = new Map(after.map((row) => [row.pid, row.birth]));
        for (const row of refused) if (births.get(row.pid) === row.birth) kept.add(row.pid);
      }
    }
    const key = (row: { readonly pid: number; readonly birth: string }): string => `${row.pid}:${row.birth}`;
    const fresh = listed.filter((row) => (others || !REFUSED.has(row.errno)) && this.described.get(key(row))?.settled !== true);
    const learned = new Map<string, Described>();
    if (fresh.length > 0) {
      const facts = this.processes.processFacts(fresh.map((row) => row.pid));
      if (!('refusal' in facts))
        for (const one of facts.processes) {
          const args = one.args._tag === 'Read' ? one.args.value.join(' ') : undefined;
          const invoked = one.args._tag === 'Read' && one.args.value[0] !== '' ? one.args.value[0] : undefined;
          learned.set(key(one), {
            executable: one.executable._tag === 'Read' ? one.executable.value : invoked,
            invoked,
            command:
              args === undefined || args === '' ? undefined : args.length > COMMAND_CHARS ? `${args.slice(0, COMMAND_CHARS)}…` : args,
            settled: false,
          });
        }
    }
    const described = new Map<string, Described>();
    for (const row of listed) {
      const earlier = this.described.get(key(row));
      const read = learned.get(key(row));
      const one = read === undefined || (read.executable === undefined && earlier !== undefined) ? earlier : read;
      if (one !== undefined) described.set(key(row), { ...one, settled: one.settled || observedAt - row.startedAtMs >= SETTLED_MS });
    }
    this.described = described;
    const placed = listed.map((row) => {
      const one = described.get(key(row));
      const named = one?.invoked ?? one?.executable;
      return {
        pid: row.pid,
        parent: row.parent,
        responsible: row.errno === 0 || kept.has(row.pid) ? row.responsible : undefined,
        executable: one?.executable,
        invoked: one?.invoked,
        name: named === undefined ? `process ${row.pid}` : baseName(named).replace(/^-/, '') || baseName(named),
      };
    });
    const programs = programsOf(placed);
    const rows = listed.map((row, index): ProcessCounters => {
      const name = placed[index]!.name;
      const one = described.get(key(row));
      const base = {
        pid: row.pid,
        birth: row.birth,
        parent: row.parent,
        onBehalfOf: placed[index]!.responsible === row.pid ? undefined : placed[index]!.responsible,
        work: row.work,
        zombie: row.zombie,
        gpu: GPU,
        name,
        command: one?.command,
        program: programs.get(row.pid)!,
      };
      if (row.errno === 0)
        return {
          ...base,
          cpu: { micros: row.cpuMicros + row.childMicros, reapedMicros: row.childMicros },
          residentBytes: row.residentBytes,
          footprintBytes: row.footprintBytes,
          memoryKind: row.footprintBytes === undefined ? 'resident' : 'footprint',
          signal: !row.zombie,
        };
      const lent = kept.has(row.pid) ? borrowedRead.read.get(row.pid) : undefined;
      if (lent !== undefined)
        return {
          ...base,
          cpu: { micros: lent.micros, reapedMicros: undefined },
          residentBytes: lent.residentBytes,
          footprintBytes: undefined,
          memoryKind: 'resident',
          signal: false,
        };
      return {
        ...base,
        cpu: undefined,
        residentBytes: undefined,
        footprintBytes: undefined,
        signal: !row.zombie && !REFUSED.has(row.errno),
        unread: REFUSED.has(row.errno)
          ? others
            ? `the system refused this process's counters and /bin/ps did not read them${borrowedRead.detail === undefined ? '' : ` (${borrowedRead.detail})`}`
            : "the system refused this process's counters"
          : `the native counter read answered errno ${row.errno}`,
      };
    });
    return {
      observedAt,
      takenAtMicros,
      processes: rows,
      machine: 'errno' in machine ? { unavailable: `the native machine read answered errno ${machine.errno}` } : machine,
    };
  }
}
