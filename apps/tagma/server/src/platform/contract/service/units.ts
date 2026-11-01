import type { ReturnedRows } from '@runlith/sqlite-process/channel';
import type { SQLWrapper } from 'drizzle-orm';
import { Context, Data, type Effect } from 'effect';
import type { StoreBrand, StoreFailure, StoreIdentity } from './store.js';
import type { WriteSet } from './writes.js';

declare const unitBrand: unique symbol;
declare const writeUnit: unique symbol;
declare const programBrand: unique symbol;

type ProgramText = { readonly sql: string; readonly params: ReadonlyArray<unknown> };

export type ProgramQuery = Effect.Effect<unknown, StoreFailure> & ({ toSQL(): ProgramText } | { getQuery(): ProgramText });

type ReturningQuery = ProgramQuery & SQLWrapper;

export type ProgramUnit<Brand extends StoreBrand> = {
  readonly store: StoreIdentity;
  write(statement: ProgramQuery, changes?: number): Effect.Effect<void, StoreFailure>;
  guard(statement: ProgramQuery, rows: number): Effect.Effect<void, StoreFailure>;
  returning(statement: ReturningQuery, after: (rows: ReturnedRows) => Effect.Effect<void>): Effect.Effect<void, StoreFailure>;
  afterCommit(effect: Effect.Effect<void>): Effect.Effect<void>;
  readonly [programBrand]: (brand: Brand) => Brand;
};

export const programUnitOf = <Brand extends StoreBrand>(unit: Omit<ProgramUnit<Brand>, typeof programBrand>): ProgramUnit<Brand> =>
  unit as ProgramUnit<Brand>;

export class ProgramConflict extends Data.TaggedError('ProgramConflict')<{
  readonly store: string;
  readonly operation: string;
  readonly identity: string;
  readonly statement: number;
  readonly expected: number | null;
  readonly actual: number | null;
}> {
  override get message(): string {
    const found =
      this.expected === null ? 'broke a uniqueness constraint' : `counted ${this.actual} rows where ${this.expected} were expected`;
    return `${this.store}: statement ${this.statement} of the ${this.operation} program ${this.identity} ${found}, so the program wrote nothing`;
  }
}

export type Unit<Brand extends StoreBrand> = {
  readonly store: StoreIdentity;
  readonly snapshot?: true;
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

export type ReadOptions = { readonly bulk?: boolean; readonly snapshot?: boolean };

export type Units<Brand extends StoreBrand> = {
  write<T, E>(operation: WriteSet | string, work: (unit: WriteUnit<Brand>) => Effect.Effect<T, E>): Effect.Effect<T, E | StoreFailure>;
  program<T, E>(
    operation: WriteSet,
    identity: string,
    work: (unit: ProgramUnit<Brand>) => Effect.Effect<T, E>,
  ): Effect.Effect<T, E | StoreFailure | ProgramConflict>;
  read<T, E>(work: (unit: Unit<Brand>) => Effect.Effect<T, E>, options?: ReadOptions): Effect.Effect<T, E | StoreFailure>;
  markReadOnly<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  markWrite<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
};

export class MachineUnits extends Context.Service<MachineUnits, Units<'machine'>>()('tagma/platform/MachineUnits') {}

export class GraphUnits extends Context.Service<GraphUnits, Units<'graph'>>()('tagma/platform/GraphUnits') {}
