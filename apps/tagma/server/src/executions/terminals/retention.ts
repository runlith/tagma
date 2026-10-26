import { Effect } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits, WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { terminalRequestKey, terminalRequestKeyTally } from '../store/terminal.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import type { ExecutionStoreFailure } from '../store/rows.js';
import { type RequestKeys } from '../store/requestKeys.js';
import { RETAINED_DETAIL_MS, RETAINED_SPENT_MS } from '../contract/wire/requestKeys.js';

const FORGOTTEN_PER_UNIT = 1_000;

const unavailable = (cause: ExecutionStoreFailure | StoreFailure): ExecutionStoreFailure =>
  cause instanceof TerminalUnavailable
    ? cause
    : new TerminalUnavailable({ owner: 'store', message: `The machine store could not answer: ${cause.message}` });

const forgetSpent = (
  units: MachineUnits['Service'],
  requestKeys: RequestKeys,
  before: number,
): Effect.Effect<void, ExecutionStoreFailure> =>
  units
    .write(writes('terminalRetention.forgetSpent', [terminalRequestKey, terminalRequestKeyTally]), (unit: WriteUnit<'machine'>) =>
      requestKeys.forget(unit, before, FORGOTTEN_PER_UNIT),
    )
    .pipe(
      Effect.mapError(unavailable),
      Effect.flatMap((forgotten) => (forgotten < FORGOTTEN_PER_UNIT ? Effect.void : forgetSpent(units, requestKeys, before))),
    );

export const runRetention = (
  units: MachineUnits['Service'],
  requestKeys: RequestKeys,
  now: number,
): Effect.Effect<number, ExecutionStoreFailure> =>
  units
    .write(writes('terminalRetention.runRetention', [terminalRequestKey, terminalRequestKeyTally]), (unit: WriteUnit<'machine'>) =>
      requestKeys.recount(unit).pipe(Effect.andThen(requestKeys.reclaim(unit, now - RETAINED_DETAIL_MS))),
    )
    .pipe(
      Effect.mapError(unavailable),
      Effect.tap(() => forgetSpent(units, requestKeys, now - RETAINED_SPENT_MS)),
    );
