import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { MergeReceipt } from '../wire/merge.js';

export class MergeReceipts extends Context.Service<
  MergeReceipts,
  {
    readonly read: (rootId: RootId, commit: string) => Effect.Effect<MergeReceipt | null, StoreFailure>;
    readonly recorded: (unit: Unit<'machine'>, rootId: RootId, commit: string) => Effect.Effect<boolean, StoreFailure>;
    readonly record: (unit: WriteUnit<'machine'>, projectId: number, receipt: MergeReceipt) => Effect.Effect<void, StoreFailure>;
  }
>()('tagma/landing/MergeReceipts') {}
