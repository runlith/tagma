import { Effect } from 'effect';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { Witnesses } from '../lines/evidence.js';
import { debtRowsAt } from '../record/debts.js';
import { landedAt } from '../record/landed.js';
import type { StoreShape } from '../record/places.js';
import { releasedAt } from '../record/released.js';

export const witnessesAt = (
  units: MachineUnits['Service'],
  store: StoreShape,
  checkout: string,
  paths: readonly string[],
): Effect.Effect<ReadonlyMap<string, Witnesses>, StoreFailure> =>
  Effect.map(
    Effect.all(
      [releasedAt(units, store, checkout, paths), debtRowsAt(units, store, checkout, paths), landedAt(units, store, checkout, paths)],
      {
        concurrency: 3,
      },
    ),
    ([released, debts, landed]) =>
      new Map(
        paths.map(
          (path) => [path, { released: released.get(path) ?? [], debts: debts.get(path) ?? [], landed: landed.get(path) ?? [] }] as const,
        ),
      ),
  );

export const witnessKey = ({ released, debts, landed }: Witnesses): string =>
  released.length + debts.length + landed.length === 0
    ? ''
    : [
        released.map((one) => `${one.row}:${one.reason}`).join(','),
        debts.map((debt) => `${debt.commit}:${debt.windowCount}`).join(','),
        landed.map((one) => one.digest).join(','),
      ].join('|');
