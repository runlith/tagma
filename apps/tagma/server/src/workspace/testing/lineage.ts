import { Effect } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { recordsOver } from '../../thread-record/testing/records.js';
import { lineageOf } from '../assignments/lineage.js';

export const lineageOver = (store: MachineStore['Service'], units: MachineUnits['Service']) =>
  Effect.map(recordsOver(store, units), lineageOf);
