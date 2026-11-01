import { bulk, readOnly, type SnapshotReader, writes } from '@runlith/sqlite-process/SqliteProcess';
import { type Context, Effect, Layer } from 'effect';
import type { Store, StoreBrand, StoreFailure } from '../contract/service/store.js';
import { type ReadOptions, type Unit, unitOf, type Units } from '../contract/service/units.js';
import { UnitEnd } from './life.js';
import { UnitStore } from './transaction.js';

export const unitsLayer = <IU, IS, Brand extends StoreBrand>(
  unitsTag: Context.Key<IU, Units<Brand>>,
  storeTag: Context.Key<IS, Store<Brand>>,
): Layer.Layer<IU, never, IS> =>
  Layer.effect(
    unitsTag,
    Effect.gen(function* () {
      const { identity, connections, transaction, program } = yield* storeTag;
      const readUnit = <T, E>(
        work: (unit: Unit<Brand>) => Effect.Effect<T, E>,
        options: ReadOptions | undefined,
        reader: SnapshotReader | null,
      ): Effect.Effect<T, E | StoreFailure> =>
        Effect.suspend(() => {
          const mark = options?.bulk === true ? bulk : readOnly;
          const end = new UnitEnd();
          const unit = end.bind(
            unitOf<Brand>({
              store: identity,
              snapshot: reader === null ? undefined : true,
              run: (query) => {
                const reading = Effect.provideService(mark(query), UnitStore, identity);
                return reader === null ? reading : reader.run(reading);
              },
            }),
          );
          return Effect.ensuring(
            Effect.suspend(() => work(unit)),
            Effect.sync(() => end.close()),
          );
        });
      const units: Units<Brand> = {
        write: transaction,
        program,
        read: (work, options) =>
          options?.snapshot === true
            ? connections.readSnapshot((reader) => readUnit(work, options, reader), options.bulk === true ? 'bulk' : 'point')
            : readUnit(work, options, null),
        markReadOnly: readOnly,
        markWrite: writes,
      };
      return units;
    }),
  );
