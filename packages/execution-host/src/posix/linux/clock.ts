import { CString, dlopen, FFIType } from 'bun:ffi';
import { ProcessesUnreadable } from '../../ProcessReader';

const symbols = {
  execution_platform_clock_ticks: { args: [], returns: FFIType.u64 },
  execution_platform_boot_nanos: { args: [], returns: FFIType.u64 },
  execution_platform_error: { args: [], returns: FFIType.ptr },
} as const;

const SECOND = 1_000_000_000n;

const ticksOf = (birth: string): bigint | ProcessesUnreadable => {
  const matched = /^(0|[1-9]\d{0,19}):0$/u.exec(birth);
  if (matched === null) return new ProcessesUnreadable({ detail: 'the birth is not a Linux kernel start-time witness' });
  const ticks = BigInt(matched[1]!);
  return ticks > 18_446_744_073_709_551_615n
    ? new ProcessesUnreadable({ detail: 'the birth exceeds the kernel start-time counter' })
    : ticks;
};

export class BirthClock {
  private constructor(
    private readonly frequency: bigint,
    private readonly boot: bigint,
  ) {}

  static load(path: string): BirthClock {
    const library = dlopen(path, symbols);
    try {
      const frequency = BigInt(library.symbols.execution_platform_clock_ticks());
      const boot = BigInt(library.symbols.execution_platform_boot_nanos());
      if (frequency <= 0n || boot <= 0n) {
        const error = library.symbols.execution_platform_error();
        throw new Error(error === null ? 'the kernel clock metadata could not be read' : new CString(error).toString());
      }
      return new BirthClock(frequency, boot);
    } finally {
      library.close();
    }
  }

  private earliest(ticks: bigint): bigint {
    return this.boot + (ticks * SECOND) / this.frequency;
  }

  private before(ticks: bigint): bigint {
    return this.boot + ((ticks + 1n) * SECOND + this.frequency - 1n) / this.frequency;
  }

  startedAt(first: bigint, _second: bigint): number {
    return Number(this.earliest(first) / 1000n) / 1000;
  }

  compareBirth = (left: string, right: string): number | ProcessesUnreadable => {
    const a = ticksOf(left);
    if (a instanceof ProcessesUnreadable) return a;
    const b = ticksOf(right);
    return b instanceof ProcessesUnreadable ? b : a < b ? -1 : a > b ? 1 : 0;
  };

  bornBetween = (birth: string, fromMs: number, untilMs: number): boolean | ProcessesUnreadable => {
    const ticks = ticksOf(birth);
    if (ticks instanceof ProcessesUnreadable) return ticks;
    const from = Math.ceil(fromMs * 1000);
    const until = Math.floor(untilMs * 1000);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from > until)
      return new ProcessesUnreadable({ detail: 'the accounting interval cannot be compared to the kernel start time' });
    const earliest = this.earliest(ticks);
    const before = this.before(ticks);
    const start = BigInt(from) * 1000n;
    const end = BigInt(until) * 1000n;
    if (before <= start || earliest > end) return false;
    if (earliest >= start && before <= end + 1n) return true;
    return new ProcessesUnreadable({ detail: 'the kernel keeps this start time to a clock tick that straddles the interval bound' });
  };
}
