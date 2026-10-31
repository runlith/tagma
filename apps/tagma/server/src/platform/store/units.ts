import { bulk, readOnly, writes } from '@runlith/sqlite-process/SqliteProcess';
import { type Context, Effect, Layer } from 'effect';
import type { Store, StoreBrand, StoreFailure } from '../contract/service/store.js';
import {
  type ProgramConflict,
  type ProgramUnit,
  type ReadOptions,
  type Unit,
  unitOf,
  type Units,
  type WriteUnit,
} from '../contract/service/units.js';
import type { WriteSet } from '../contract/service/writes.js';
import { UnitStore } from './transaction.js';

export const unitsLayer = <IU, IS, Brand extends StoreBrand>(
  unitsTag: Context.Key<IU, Units<Brand>>,
  storeTag: Context.Key<IS, Store<Brand>>,
): Layer.Layer<IU, never, IS> =>
  Layer.effect(
    unitsTag,
    Effect.map(storeTag, (store) => new ConnectionUnits(store)),
  );

class ConnectionUnits<Brand extends StoreBrand> implements Units<Brand> {
  constructor(private readonly store: Store<Brand>) {}

  write<T, E>(operation: WriteSet | string, work: (unit: WriteUnit<Brand>) => Effect.Effect<T, E>): Effect.Effect<T, E | StoreFailure> {
    return this.store.transaction(operation, work);
  }

  program<T, E>(
    operation: WriteSet,
    identity: string,
    work: (unit: ProgramUnit<Brand>) => Effect.Effect<T, E>,
  ): Effect.Effect<T, E | StoreFailure | ProgramConflict> {
    return this.store.program(operation, identity, work);
  }

  read<T, E>(work: (unit: Unit<Brand>) => Effect.Effect<T, E>, options?: ReadOptions): Effect.Effect<T, E | StoreFailure> {
    const mark = options?.bulk === true ? bulk : readOnly;
    return work(
      unitOf<Brand>({
        store: this.store.identity,
        run: <A>(query: Effect.Effect<A, StoreFailure>) => Effect.provideService(mark(query), UnitStore, this.store.identity),
      }),
    );
  }

  markReadOnly<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return readOnly(effect);
  }

  markWrite<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return writes(effect);
  }
}
