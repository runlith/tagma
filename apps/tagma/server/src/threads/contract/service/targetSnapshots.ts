import { Context, Data, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { WorkspaceGeneration } from '../../../workspace/contract/wire/ids.js';
import type { TargetAt } from '../../../workspace/contract/wire/place.js';
import type { GraphOrigin, TargetSnapshot } from '../wire/target.js';

export class TargetStorageFailed extends Data.TaggedError('TargetStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Target snapshot ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export type TargetStoreFailure = StoreFailure | TargetStorageFailed;

export type ActiveTarget =
  | { readonly state: 'admitted'; readonly target: TargetSnapshot }
  | { readonly state: 'unavailable'; readonly reason: 'no-run' }
  | { readonly state: 'unavailable'; readonly reason: 'no-target'; readonly runId: string; readonly generation: WorkspaceGeneration };

export class TargetSnapshots extends Context.Service<
  TargetSnapshots,
  {
    readonly writes: WriteSet;
    record(target: TargetSnapshot, unit: Unit<'machine'>): Effect.Effect<TargetSnapshot, TargetStoreFailure>;
    at(key: TargetAt, unit: Unit<'machine'>): Effect.Effect<TargetSnapshot | undefined, TargetStoreFailure>;
    readActive(threadId: string, unit: Unit<'machine'>): Effect.Effect<ActiveTarget, TargetStoreFailure>;
    origins(
      threadId: string,
      runIds: readonly string[] | null,
      unit: Unit<'machine'>,
    ): Effect.Effect<readonly GraphOrigin[], TargetStoreFailure>;
  }
>()('tagma/threads/TargetSnapshots') {}
