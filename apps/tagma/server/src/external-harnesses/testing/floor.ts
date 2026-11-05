import { Effect } from 'effect';
import { ThreadEntryKinds, makeThreadEntryReader } from '@runlith/agent/transcript/kinds';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { WorkSpells } from '../../thread-record/contract/service/spells.js';
import { HarnessSessionStore, type SessionPublished } from '../store/sessions.js';
import { ModelChanges } from '../../threads/contract/service/modelChanges.js';
import { makeSessionRows } from '../store/rows.js';

export const sessionRowsOver = (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  spells: WorkSpells['Service'],
  records: ThreadRecords['Service'],
  models: ModelChanges['Service'],
) =>
  makeSessionRows({ db }).pipe(
    Effect.provideService(ThreadEntryKinds, makeThreadEntryReader({ products: [] })),
    Effect.provideService(MachineUnits, units),
    Effect.provideService(WorkSpells, spells),
    Effect.provideService(ThreadRecords, records),
    Effect.provideService(ModelChanges, models),
  );

export const sessionStoreOver = (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  spells: WorkSpells['Service'],
  records: ThreadRecords['Service'],
  models: ModelChanges['Service'],
  published: SessionPublished = () => Effect.void,
) => sessionRowsOver(db, units, spells, records, models).pipe(Effect.map((rows) => new HarnessSessionStore(rows, published)));
