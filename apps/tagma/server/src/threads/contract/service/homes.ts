import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { HomeMove } from '../../../thread-record/contract/service/homes.js';

export class ThreadHomes extends Context.Service<
  ThreadHomes,
  {
    readonly writes: WriteSet;
    admit(unit: WriteUnit<'machine'>, move: HomeMove): Effect.Effect<void, StoreFailure | GateRefusal>;
    move(unit: WriteUnit<'machine'>, move: HomeMove): Effect.Effect<void, StoreFailure | GateRefusal>;
  }
>()('tagma/threads/ThreadHomes') {}
