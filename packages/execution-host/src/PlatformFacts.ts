import { Data, Context, type Effect } from 'effect';
import type {
  DescriptorExpenses,
  HostPlatform,
  NativeRelation,
  NativeIdentity,
  RuntimeIdentity,
  PlatformLimits,
  PlatformState,
} from '@runlith/executions/protocol/capacity';
import type { Transport } from '@runlith/executions/protocol/execution';

export type PlatformIdentity = {
  readonly platform: HostPlatform;
  readonly runtime: RuntimeIdentity;
  readonly native: NativeIdentity;
  readonly transports: ReadonlyArray<Transport>;
  readonly relations: ReadonlyArray<NativeRelation>;
};

export type TransportExpenses = Readonly<Record<Transport, DescriptorExpenses>>;

export class LimitsUnreadable extends Data.TaggedError('LimitsUnreadable')<{ readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class StandingUnreadable extends Data.TaggedError('StandingUnreadable')<{ readonly region: string; readonly detail: string }> {
  override get message(): string {
    return this.detail;
  }
}

export class PlatformFacts extends Context.Service<
  PlatformFacts,
  {
    readonly identity: PlatformIdentity;
    readonly descriptors: TransportExpenses;
    readonly limits: Effect.Effect<PlatformLimits, LimitsUnreadable>;
    readonly standing: (observe: () => void) => Effect.Effect<PlatformState, StandingUnreadable>;
    readonly recountMs: number;
    readonly uptimeNanos: () => bigint;
  }
>()('@runlith/execution-host/PlatformFacts') {}
