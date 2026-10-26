import { Context, type Effect } from 'effect';
import type { StoreBrand, StoreFailure, StoreIdentity } from './store.js';
import type { WriteSet } from './writes.js';

declare const unitBrand: unique symbol;
declare const writeUnit: unique symbol;

export type Unit<Brand extends StoreBrand> = {
  readonly store: StoreIdentity;
  run<A>(query: Effect.Effect<A, StoreFailure>): Effect.Effect<A, StoreFailure>;
  readonly [unitBrand]: (brand: Brand) => Brand;
};

export type WriteUnit<Brand extends StoreBrand> = Unit<Brand> & {
  readonly [writeUnit]: true;
  afterCommit(effect: Effect.Effect<void>): Effect.Effect<void>;
};

type Unbranded<U> = Omit<U, typeof unitBrand | typeof writeUnit>;

export const unitOf = <Brand extends StoreBrand>(unit: Unbranded<Unit<Brand>>): Unit<Brand> => unit as Unit<Brand>;

export const writeUnitOf = <Brand extends StoreBrand>(unit: Unbranded<WriteUnit<Brand>>): WriteUnit<Brand> => unit as WriteUnit<Brand>;

export type ReadOptions = { readonly bulk?: boolean };

export type Units<Brand extends StoreBrand> = {
  write<T, E>(operation: WriteSet | string, work: (unit: WriteUnit<Brand>) => Effect.Effect<T, E>): Effect.Effect<T, E | StoreFailure>;
  read<T, E>(work: (unit: Unit<Brand>) => Effect.Effect<T, E>, options?: ReadOptions): Effect.Effect<T, E | StoreFailure>;
  markReadOnly<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  markWrite<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
};

export class MachineUnits extends Context.Service<MachineUnits, Units<'machine'>>()('tagma/platform/MachineUnits') {}

export class GraphUnits extends Context.Service<GraphUnits, Units<'graph'>>()('tagma/platform/GraphUnits') {}
