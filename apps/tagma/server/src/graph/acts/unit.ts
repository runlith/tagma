import { Context, Effect, Layer, Option } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { FloorRefusal, GateRefusal } from '../../platform/contract/wire/refusal.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { type WriteSet, writes } from '../../platform/contract/service/writes.js';
import { acting } from '../store/actWrites.js';
import { ActState } from '../contract/service/transaction.js';
import { unitState, withUnit } from './state.js';
import { CurrentGraph } from '../contract/service/serving.js';
import { writableAt } from '../serving/writing.js';
import { Tags } from '../contract/service/vocabulary.js';
import {
  type TreeLanding,
  type TreeWrite,
  Act,
  BlockAnswers,
  BlockNames,
  BlockProjection,
  BlockReferences,
  CommitEffects,
  TreeGuard,
} from '../contract/service/acts.js';
import { blockNames } from './names.js';
import { actMarks, blockAnswers } from './measurement.js';
import { actRecords } from './records.js';
import { blockProjection, blockReferences } from './derived.js';
import { projectTypeIds } from '../vocabulary/typeProjection.js';
import { BlockRows, blockRows } from './rows.js';
import { GraphUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';

export function actUnit(store: GraphStore['Service'], tags: Tags['Service']) {
  const sets = new WeakMap<WriteSet, WeakMap<WriteSet, WriteSet>>();
  const joinedOnce = (declared: WriteSet, machinery: WriteSet): WriteSet => {
    const byMachinery = sets.get(declared) ?? new WeakMap<WriteSet, WriteSet>();
    sets.set(declared, byMachinery);
    const known = byMachinery.get(machinery);
    if (known !== undefined) return known;
    const set = writes(declared.operation, [], declared, machinery);
    byMachinery.set(machinery, set);
    return set;
  };
  return Effect.fnUntraced(function* <A, E, R>(
    declared: WriteSet,
    body: Effect.Effect<A, E, R>,
  ): Effect.fn.Return<A, E | StoreFailure | GateRefusal<FloorRefusal>, Exclude<R, ActState>> {
    yield* writableAt(yield* CurrentGraph);
    const open = yield* Effect.serviceOption(ActState);
    if (Option.isSome(open)) {
      const set = joinedOnce(declared, acting);
      const outerUnit = open.value.unit;
      const held = open.value;
      const recordedBefore = held.recorded.length;
      const vocabulary = new Set(held.vocabulary);
      const tables = new Map(held.tables);
      return yield* store.transaction(
        set,
        (unit) =>
          Effect.provideService(body, ActState, withUnit(held, unit)).pipe(
            Effect.onError(() =>
              Effect.sync(() => {
                held.recorded.length = recordedBefore;
                held.vocabulary.clear();
                for (const projectId of vocabulary) held.vocabulary.add(projectId);
                held.tables.clear();
                for (const [id, table] of tables) held.tables.set(id, table);
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                open.value.unit = outerUnit;
              }),
            ),
          ),
        { settlement: 'savepoint' },
      );
    }
    const held = unitState();
    const floor = yield* TreeGuard;
    const set = joinedOnce(declared, floor === undefined ? acting : joinedOnce(floor.writes, acting));
    let landing: TreeLanding = Effect.void;
    const transaction = (write: TreeWrite | undefined) =>
      store.transaction(
        set,
        (unit) =>
          write === undefined
            ? Effect.provideService(body.pipe(Effect.tap(() => projectTypeIds(store.db, tags))), ActState, withUnit(held, unit))
            : Effect.gen(function* () {
                const value = yield* Effect.provideService(
                  body.pipe(Effect.tap(() => projectTypeIds(store.db, tags))),
                  ActState,
                  withUnit(held, unit),
                );
                if (held.recorded.length > 0) landing = yield* write([...held.recorded]);
                return value;
              }),
        {
          onCommit: Effect.fnUntraced(function* () {
            yield* tags.publish(held);
            for (const hook of yield* CommitEffects) yield* hook;
            yield* landing;
          }),
        },
      );
    const guarded =
      floor === undefined
        ? transaction(undefined)
        : Effect.flatMap(floor.prepare, (projection) =>
            floor.guard(transaction(projection.write).pipe(Effect.tapCause(() => projection.undo))),
          );
    return yield* guarded;
  });
}

export type ActServices = Act | BlockNames | BlockAnswers | BlockProjection | BlockReferences | BlockRows;

export const actLayer: Layer.Layer<ActServices, never, GraphStore | WriterRegister | Tags> = Layer.effectContext(
  Effect.gen(function* () {
    const store = yield* GraphStore;
    const { db } = store;
    const units = yield* GraphUnits;
    const sessions = yield* WriterRegister;
    const tags = yield* Tags;

    const unit = actUnit(store, tags);
    const marks = actMarks(db, tags);
    const recorded = actRecords(db, sessions, tags);
    const references = blockReferences(db);

    return Context.make(Act, Act.of({ unit, record: recorded.record })).pipe(
      Context.add(BlockNames, blockNames(db, units)),
      Context.add(BlockAnswers, blockAnswers(db, tags)),
      Context.add(BlockProjection, blockProjection(db, tags, unit)),
      Context.add(BlockReferences, references),
      Context.add(BlockRows, blockRows(db, marks.records, references.refsIn, recorded)),
    );
  }),
).pipe(Layer.provide(unitsLayer(GraphUnits, GraphStore)));
