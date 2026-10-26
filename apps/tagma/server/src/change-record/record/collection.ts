import { Effect, Queue } from 'effect';
import type { StandingSweep } from '../../platform/contract/service/maintenance.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { WalkUnfinished, type Walks } from '../lines/walks.js';
import type { StoreShape } from './places.js';
import { requeueTexts, retireTexts } from './texts.js';
import { collectReleased, sweepVersions } from './versions.js';

const reported = (what: string, work: Effect.Effect<number, StoreFailure | WalkUnfinished>, told: boolean): Effect.Effect<void> =>
  Effect.flatMap(Effect.result(work), (done) =>
    done._tag === 'Failure'
      ? Effect.logWarning(`${what} could not be collected`, {
          reason: done.failure instanceof WalkUnfinished ? done.failure.reason : done.failure.message,
        })
      : told && done.success > 0
        ? Effect.logInfo(`${what} collected`, { rows: done.success })
        : Effect.void,
  );

const released = (units: MachineUnits['Service'], store: StoreShape, walks: Walks, told: boolean): Effect.Effect<void> =>
  Effect.andThen(
    reported('released versions', collectReleased(units, store), told),
    reported('texts of committed and withdrawn rows', retireTexts(units, store, walks), told),
  );

export const collecting = (
  units: MachineUnits['Service'],
  store: StoreShape,
  walks: Walks,
  wake: Queue.Dequeue<void>,
): Effect.Effect<never> => Effect.forever(Effect.andThen(Queue.take(wake), released(units, store, walks, false)));

export const collectionSweep =
  (units: MachineUnits['Service'], store: StoreShape, walks: Walks): StandingSweep =>
  (moment) =>
    Effect.andThen(
      reported('hunks of rows no standing row holds back', requeueTexts(units, store), false),
      Effect.andThen(released(units, store, walks, true), reported(`unheld versions (${moment})`, sweepVersions(units, store), true)),
    );
