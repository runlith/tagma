import { Data, Context, type Effect, type Scope } from 'effect';
import type { MachineMemory } from '@runlith/executions/protocol/evidence';

export class UsageUnavailable extends Data.TaggedError('UsageUnavailable')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export type MachineCounters = {
  readonly busy: number;
  readonly total: number;
  readonly cores: number;
  readonly memory: MachineMemory;
};

export type ProcessProgram = { readonly key: string; readonly name: string; readonly where?: string };

export type CpuCounter = {
  readonly micros: number;
  readonly reapedMicros: number | undefined;
};

export type ProcessCounters = {
  readonly pid: number;
  readonly birth: string;
  readonly parent: number;
  readonly work: number;
  readonly zombie: boolean;
  readonly cpu: CpuCounter | undefined;
  readonly residentBytes: number | undefined;
  readonly footprintBytes: number | undefined;
  readonly signal: boolean;
  readonly unread?: string;
  readonly name: string;
  readonly command?: string;
  readonly program: ProcessProgram;
};

export type UsageRead = {
  readonly observedAt: number;
  //! the reader's own monotonic clock at the counters, so an answer delayed on its way never stretches the interval
  readonly takenAtMicros: number;
  readonly processes: ReadonlyArray<ProcessCounters>;
  readonly machine: MachineCounters | { readonly unavailable: string };
};

export class UsageSource extends Context.Service<
  UsageSource,
  {
    readonly open: Effect.Effect<UsageReader, UsageUnavailable, Scope.Scope>;
  }
>()('@runlith/execution-host/UsageSource') {}

export interface UsageReader {
  read(): Effect.Effect<UsageRead, UsageUnavailable>;
}
