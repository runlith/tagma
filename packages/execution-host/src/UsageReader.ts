import { Data, Context, type Effect, type Scope } from 'effect';
import type { MachineMemory, MemoryKind } from '@runlith/executions/protocol/evidence';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';

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

export type ProcessGpu = { readonly _tag: 'Measured'; readonly micros: number } | { readonly _tag: 'Unavailable'; readonly reason: string };

export type ProcessCounters = {
  readonly pid: number;
  readonly birth: string;
  readonly parent: number;
  readonly onBehalfOf?: number;
  readonly work: number;
  readonly zombie: boolean;
  readonly cpu: CpuCounter | undefined;
  readonly gpu: ProcessGpu;
  readonly residentBytes: number | undefined;
  readonly footprintBytes: number | undefined;
  readonly memoryKind?: MemoryKind;
  readonly signal: boolean;
  readonly unread?: string;
  readonly name: string;
  readonly command?: string;
  readonly program: ProcessProgram;
};

export type UsageDemand = { readonly others: boolean };

export type ContainerCounter = { readonly execution: ExecutionRef; readonly cpuMicros: number };

export type UsageRead = {
  readonly observedAt: number;
  //! the reader's own monotonic clock at the counters, so an answer delayed on its way never stretches the interval
  readonly takenAtMicros: number;
  readonly processes: ReadonlyArray<ProcessCounters>;
  readonly containers?: ReadonlyArray<ContainerCounter>;
  readonly machine: MachineCounters | { readonly unavailable: string };
};

export class UsageSource extends Context.Service<
  UsageSource,
  {
    readonly open: Effect.Effect<UsageReader, UsageUnavailable, Scope.Scope>;
  }
>()('@runlith/execution-host/UsageSource') {}

export interface UsageReader {
  readonly machineName: string;
  read(demand: UsageDemand): Effect.Effect<UsageRead, UsageUnavailable>;
}
