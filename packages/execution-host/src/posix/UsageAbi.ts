import { dlopen, FFIType, ptr } from 'bun:ffi';
import { constants } from 'node:os';
import type { MachineMemory, MemoryPressure } from '@runlith/executions/protocol/evidence';
import type { MachineCounters } from '../UsageReader';
import { birthOf } from './macos/birth';

export const USAGE_SYMBOLS = {
  execution_usage_all: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  execution_usage_machine: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const;

const ROW = 14;

export type NativeCounters = {
  readonly pid: number;
  readonly errno: number;
  readonly parent: number;
  readonly work: number;
  readonly birth: string;
  readonly startedAtMs: number;
  readonly zombie: boolean;
  readonly cpuMicros: number;
  readonly childMicros: number;
  readonly residentBytes: number;
  readonly footprintBytes: number | undefined;
  readonly memoryErrno: number;
  readonly responsible: number;
};

export class UsageAbi {
  private capacity = 2048;
  private values = new BigUint64Array(this.capacity * ROW);

  private constructor(private readonly library: ReturnType<typeof dlopen<typeof USAGE_SYMBOLS>>) {}

  static load(path: string): UsageAbi {
    return new UsageAbi(dlopen(path, USAGE_SYMBOLS));
  }

  unload(): void {
    this.library.close();
  }

  all(): ReadonlyArray<NativeCounters> | { readonly errno: number } {
    for (;;) {
      const values = this.values;
      const total = this.library.symbols.execution_usage_all(ptr(values), this.capacity);
      if (total < 0) return { errno: -total };
      if (total > this.capacity) {
        this.capacity = total + (total >> 2) + 64;
        this.values = new BigUint64Array(this.capacity * ROW);
        continue;
      }
      const rows: NativeCounters[] = new Array(total);
      for (let index = 0; index < total; index += 1) {
        const at = index * ROW;
        const word = (offset: number): number => Number(values[at + offset]!);
        const kind = word(11);
        rows[index] = {
          pid: word(0),
          errno: word(1),
          parent: word(2),
          work: word(3),
          birth: birthOf(values[at + 4]!, values[at + 5]!),
          startedAtMs: word(4) * 1000 + word(5) / 1000,
          zombie: word(6) !== 0,
          cpuMicros: word(7),
          childMicros: word(8),
          residentBytes: word(9),
          footprintBytes: kind === 0 || kind === 4 || word(12) !== 0 ? undefined : word(10),
          memoryErrno: word(12),
          responsible: word(13),
        };
      }
      return rows;
    }
  }

  machine(): MachineCounters | { readonly errno: number } {
    const values = new BigUint64Array(12);
    const errno = this.library.symbols.execution_usage_machine(ptr(values));
    if (errno !== 0) return { errno };
    const [busy, total, cores, memoryBytes, usedBytes, availableBytes, level, value, memoryErrno, pressureErrno, platform, shape] =
      Array.from(values, Number) as [number, number, number, number, number, number, number, number, number, number, number, number];
    if (platform !== 1 && platform !== 2) return { errno: constants.errno.ENOTSUP };
    const adapter = platform === 1 ? 'darwin' : 'linux';
    const probe = platform === 1 ? 'host_statistics64:HOST_VM_INFO64 + hw.memsize' : '/proc/meminfo:MemTotal,MemAvailable';
    const pressureProbe = platform === 1 ? 'kern.memorystatus_vm_pressure_level' : '/proc/pressure/memory:avg10 some/full stalls';
    const pressure: MemoryPressure =
      pressureErrno !== 0 || level === 0
        ? {
            _tag: 'Unknown',
            reason: pressureErrno === 2 ? 'unsupported' : 'failed',
            detail: `${pressureProbe} answered errno ${pressureErrno}`,
          }
        : {
            _tag: 'Measured',
            level: level === 1 ? 'normal' : level === 2 ? 'warning' : 'critical',
            source: { adapter, probe: pressureProbe },
            value: platform === 2 ? value / 1000 : value,
          };
    const memory: MachineMemory =
      shape !== 1
        ? { _tag: 'Unknown', reason: 'unsupported', detail: 'the native library reports no machine memory fields' }
        : memoryErrno !== 0
          ? { _tag: 'Unknown', reason: 'failed', detail: `${probe} answered errno ${memoryErrno}` }
          : { _tag: 'Measured', totalBytes: memoryBytes, usedBytes, availableBytes, source: { adapter, probe }, pressure };
    return { busy, total, cores, memory };
  }
}
