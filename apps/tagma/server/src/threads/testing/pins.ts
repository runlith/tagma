import { Context, Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { makeThreadPins } from '../store/pins.js';

export const pinsOver = ({
  store,
  units,
  records,
}: {
  readonly store: MachineStore['Service'];
  readonly units: MachineUnits['Service'];
  readonly records: ThreadRecords['Service'];
}) =>
  makeThreadPins.pipe(
    Effect.provide(Context.make(MachineStore, store).pipe(Context.add(MachineUnits, units), Context.add(ThreadRecords, records))),
  );
