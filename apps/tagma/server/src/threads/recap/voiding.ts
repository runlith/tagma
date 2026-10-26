import { Effect } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { voidRecap } from '../../thread-record/recaps.js';

export const voidCovered = (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  threadId: string,
  changed: readonly { readonly appeared: number }[],
): Effect.Effect<void, StoreFailure> =>
  changed.length === 0
    ? Effect.void
    : Effect.asVoid(
        voidRecap(
          db,
          unit,
          threadId,
          changed.reduce((low, row) => Math.min(low, row.appeared), Number.POSITIVE_INFINITY),
        ),
      );
