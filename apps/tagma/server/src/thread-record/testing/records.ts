import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { threadRecord } from '../store/table.js';
import type { TitleProvenance } from '../contract/wire/title.js';
import { recordFacts } from '../facts.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { RecordBirth } from '../contract/service/records.js';
import { insertRecord } from '../birth.js';
import { makeThreadFolders } from '../folders.js';
import { makeThreadRecords } from '../layer.js';

export type RecordShelf = {
  readonly title?: string;
  readonly titleOrigin?: TitleProvenance;
  readonly readerOrderAt?: Date;
  readonly pinnedAt?: Date | null;
  readonly archivedAt?: Date | null;
};

export type RecordPlace = RecordShelf & {
  readonly projectId: number;
  readonly scopeBlockUuid?: string | null;
  readonly createdBySessionId?: number | null;
};

export const scopeRecord = (db: StoreDb<'machine'>, id: string, place: RecordPlace) =>
  Effect.asVoid(
    db
      .update(threadRecord)
      .set({ readerOrderAt: new Date(), ...place, origin: 'scoped' })
      .where(eq(threadRecord.id, id)),
  );

export const shelveRecord = (db: StoreDb<'machine'>, id: string, shelf: RecordShelf) =>
  Effect.asVoid(db.update(threadRecord).set(shelf).where(eq(threadRecord.id, id)));

export const recordOf = (db: StoreDb<'machine'>, id: string) => db.select().from(recordFacts).where(eq(recordFacts.id, id)).get();

export const recordsOver = (store: MachineStore['Service'], units: MachineUnits['Service']) =>
  makeThreadRecords.pipe(Effect.provideService(MachineStore, store), Effect.provideService(MachineUnits, units));

export const foldersOver = (store: MachineStore['Service'], units: MachineUnits['Service']) =>
  makeThreadFolders.pipe(Effect.provideService(MachineStore, store), Effect.provideService(MachineUnits, units));

export const bornRecord = (db: StoreDb<'machine'>, birth: RecordBirth) => insertRecord(db, birth);
