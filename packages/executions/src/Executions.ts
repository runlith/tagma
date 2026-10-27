import { Context, Data, type Effect, Schema } from 'effect';
import type { CancellationCause } from './protocol/call';
import type { InventoryChanges, InventoryRevision, InventoryFeedItem } from './protocol/inventory';
import type { ExecutionRef, HostRequestRef } from './protocol/execution';
import type { Refusal } from './protocol/host';
import type { CancelAnswer, LaunchRequest, StartAnswer } from './protocol/launch';
import type { ScreenFeedItem } from './protocol/presentation';
import type { InputProfile } from './protocol/inputProfile';
import type { LaneInput } from './protocol/lane';
import type { LoadReading } from './protocol/evidence';
import type { RecordRange } from './protocol/record';
import type { ExecutionPage, ExecutionSummary, RetainedRecord } from './protocol/runtime';
import type { EndingReading, SignalAnswer, StopAction, StopReceipt } from './protocol/stop';
import type { SubscriptionEnding, WireFault } from './protocol/wire';

export class WireLost extends Data.TaggedError('WireLost')<{
  readonly reason: string;
  readonly sent: boolean;
}> {}

export class WireInvalid extends Data.TaggedError('WireInvalid')<{
  readonly detail: string;
}> {}

export class WireUnreadable extends Data.TaggedError('WireUnreadable')<{
  readonly detail: string;
}> {}

export class WireFailed extends Data.TaggedError('WireFailed')<{
  readonly fault: WireFault;
}> {}

export const Unavailability = Schema.Literals(['absent', 'invalid', 'mismatched', 'unreachable', 'credential']);
export type Unavailability = typeof Unavailability.Type;

export class WireUnavailable extends Data.TaggedError('WireUnavailable')<{
  readonly kind: Unavailability;
  readonly reason: string;
  readonly sent: boolean;
}> {}

export class HostRefused extends Data.TaggedError('HostRefused')<{
  readonly refusal: Refusal;
}> {}

export type ExecutionsFailure = WireLost | WireInvalid | WireUnreadable | WireFailed | WireUnavailable | HostRefused;

export type RecordChunk = { readonly range: RecordRange; readonly bytes: Uint8Array; readonly modes: InputProfile };

export type ExecutionFeedItem =
  | { readonly _tag: 'Bytes'; readonly range: RecordRange; readonly bytes: Uint8Array }
  | { readonly _tag: 'State'; readonly summary: ExecutionSummary }
  | { readonly _tag: 'Screen'; readonly update: ScreenFeedItem }
  | { readonly _tag: 'Inventory'; readonly update: InventoryFeedItem }
  | { readonly _tag: 'Inputs'; readonly input: LaneInput }
  | { readonly _tag: 'Load'; readonly reading: LoadReading }
  | { readonly _tag: 'Ended'; readonly ending: SubscriptionEnding };

export class Executions extends Context.Service<
  Executions,
  {
    readonly list: (options?: {
      readonly after?: ExecutionRef;
      readonly limit?: number;
    }) => Effect.Effect<ExecutionPage, ExecutionsFailure>;
    readonly changes: (since: InventoryRevision, limit: number) => Effect.Effect<InventoryChanges, ExecutionsFailure>;
    readonly state: (execution: ExecutionRef) => Effect.Effect<ExecutionSummary | undefined, ExecutionsFailure>;
    readonly ending: (execution: ExecutionRef, remeasure?: boolean) => Effect.Effect<EndingReading | undefined, ExecutionsFailure>;
    readonly retained: (execution: ExecutionRef) => Effect.Effect<RetainedRecord | undefined, ExecutionsFailure>;
    readonly start: (operation: HostRequestRef, launch: LaunchRequest) => Effect.Effect<StartAnswer, ExecutionsFailure>;
    readonly cancelStart: (
      operation: HostRequestRef,
      cause: CancellationCause,
      trigger: string,
      when?: 'always' | 'unadmitted',
    ) => Effect.Effect<CancelAnswer, ExecutionsFailure>;
    readonly signal: (execution: ExecutionRef, signal: string) => Effect.Effect<SignalAnswer, ExecutionsFailure>;
    readonly stop: (
      operation: HostRequestRef,
      execution: ExecutionRef,
      cause: CancellationCause,
      action: StopAction,
    ) => Effect.Effect<StopReceipt, ExecutionsFailure>;
    readonly retire: (
      operation: HostRequestRef,
      execution: ExecutionRef,
    ) => Effect.Effect<import('./protocol/wire').RetireAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/Executions') {}
