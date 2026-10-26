import { Clock, Effect } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { type Birth, insertFacet, recordAtBirth } from '../birth.js';
import { bornRecord, type RecordPlace, scopeRecord } from '../../thread-record/testing/records.js';

export type BornRow = Omit<Birth, 'cacheGroup' | 'provider'> & { readonly cacheGroup?: string; readonly provider?: string };

export const bornThread = (db: StoreDb<'machine'>, row: BornRow, place?: RecordPlace): Effect.Effect<void, StoreFailure> =>
  db.transaction(() =>
    Effect.gen(function* () {
      const birth = {
        ...row,
        provider: row.provider ?? 'test-provider',
        cacheGroup: row.cacheGroup ?? row.id,
        createdAt: row.createdAt ?? new Date(yield* Clock.currentTimeMillis),
      };
      yield* bornRecord(db, recordAtBirth(birth));
      yield* insertFacet(db, birth, modelCatalog([]));
      if (place !== undefined) yield* scopeRecord(db, row.id, place);
    }),
  );
