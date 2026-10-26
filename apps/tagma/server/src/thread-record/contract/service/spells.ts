import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';

export class WorkSpells extends Context.Service<
  WorkSpells,
  {
    readonly writes: WriteSet;
    begin(threadId: string, at: Date, tx: Unit<'machine'>): Effect.Effect<void, StoreFailure>;
    end(threadId: string, tx: Unit<'machine'>): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/thread-record/WorkSpells') {}
