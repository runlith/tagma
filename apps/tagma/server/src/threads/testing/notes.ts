import { eq } from 'drizzle-orm';
import { makeOperatorNotes } from '../notes/owner.js';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { operatorNote } from '../notes/table.js';

export const notesOver = () => makeOperatorNotes;

export const noteRowsOf = (db: StoreDb<'machine'>, units: MachineUnits['Service'], scopeKey: string) =>
  units.read((unit) => unit.run(db.select().from(operatorNote).where(eq(operatorNote.scopeKey, scopeKey))));
