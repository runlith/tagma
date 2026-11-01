import { dirname } from 'node:path';
import { Context, Data, type Effect } from 'effect';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import type { PlatformError } from 'effect/PlatformError';
import type { SqlError } from 'effect/sql/SqlError';
import type { EffectDrizzleQueryError, MigratorInitError } from 'drizzle-orm/effect-core/errors';
import type { EffectSQLiteBunDatabase } from 'drizzle-orm/effect-sqlite-bun';
import type { VacuumVerdict } from '../wire/vacuum.js';
import type { ProgramConflict, ProgramUnit, WriteUnit } from './units.js';
import type { WriteSet } from './writes.js';
import type { TableMoves } from '../../store/moves.js';
import type { SnapshotFailed, StoreSnapshots } from './snapshots.js';

export type StoreBrand = string;

declare const storeBrand: unique symbol;

export type StoreDb<Brand extends StoreBrand> = EffectSQLiteBunDatabase & { readonly [storeBrand]: (brand: Brand) => Brand };

export const storeDb = <Brand extends StoreBrand>(db: EffectSQLiteBunDatabase): StoreDb<Brand> => db as StoreDb<Brand>;

export type StoreIdentity = { readonly path: string; readonly generation: number };

export class StoreIdentityConflict extends Data.TaggedError('StoreIdentityConflict')<{
  readonly expected: StoreIdentity;
  readonly actual: StoreIdentity;
}> {}

export type SchemaState = { readonly applied: number; readonly latest: string | null };

export type StoreTransactionOptions<A, R> = {
  readonly settlement?: 'commit' | 'savepoint';
  readonly onCommit?: (value: A) => Effect.Effect<void, never, R>;
};

export const WRITER_BUDGET_MS = 5_000;

export const WRITER_STALL_MS = 60_000;

export type WriterStall = {
  readonly heldFor: string | null;
  readonly heldMs: number;
  readonly quietMs: number;
  readonly waiting: number;
};

export class MigrationChainInvalid extends Data.TaggedError('MigrationChainInvalid')<{
  readonly disagreements: ReadonlyArray<string>;
  readonly folder: string;
}> {
  override get message(): string {
    return (
      `the migration chain disagrees with what this database applied — ${this.disagreements.join('; ')}. ` +
      `A migration already applied is history: restore the folder under ${this.folder} exactly as it was, ` +
      'from version control, and correct it with a NEW migration instead. Nothing here rewrites an ' +
      'applied chain, and a database that has run one cannot be opened until the file it ran is back.'
    );
  }
}

export class BaselineNotReached extends Data.TaggedError('BaselineNotReached')<{
  readonly folder: string;
  readonly applied: number;
  readonly cut: number;
  readonly release: string;
}> {
  override get message(): string {
    return `the database applied ${this.applied} migrations as the chain shipped them but not all ${this.cut} below the baseline cut: open it once with Tagma ${this.release}, which brings it to the baseline, then this release opens it`;
  }
}

export class MigrationStatementUnresolved extends Data.TaggedError('MigrationStatementUnresolved')<{
  readonly migration: string;
  readonly statement: string;
}> {
  override get message(): string {
    return `migration ${this.migration} has a statement whose writes cannot be resolved: ${this.statement}`;
  }
}

export class SetAsideFailed extends Data.TaggedError('SetAsideFailed')<{ readonly path: string; readonly reason: string }> {
  override get message(): string {
    return `the tables a migration sets aside could not be kept at ${this.path}: ${this.reason}`;
  }
}

export type Adopting = { readonly files: readonly string[]; readonly after: Effect.Effect<void> };

export type StoreOpenFailure =
  | SetAsideFailed
  | MigrationStatementUnresolved
  | MigrationChainInvalid
  | BaselineNotReached
  | MigratorInitError
  | EffectDrizzleQueryError
  | SqlError
  | PlatformError
  | SnapshotFailed;

export type StoreFailure = EffectDrizzleQueryError | SqlError;

export type MigrationChain<Brand extends StoreBrand> = {
  readonly folder: string;
  readonly seeds: string;
  readonly snapshots?: StoreSnapshots['Service'];
};

export type Store<Brand extends StoreBrand> = {
  readonly processes: ProcessPool;
  readonly durable: boolean;
  readonly db: StoreDb<Brand>;
  readonly path: string;
  readonly identity: StoreIdentity;
  readonly schema: SchemaState;
  readonly transaction: <A, E, R, RCommit = never>(
    operation: WriteSet | string,
    body: (unit: WriteUnit<Brand>) => Effect.Effect<A, E, R>,
    options?: StoreTransactionOptions<A, RCommit>,
  ) => Effect.Effect<A, E | StoreFailure, R | RCommit>;
  readonly program: <A, E>(
    operation: WriteSet,
    identity: string,
    work: (unit: ProgramUnit<Brand>) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | StoreFailure | ProgramConflict>;
  readonly readOnly: <A, E, R>(work: (db: StoreDb<Brand>) => Effect.Effect<A, E, R>) => Effect.Effect<A, E | StoreFailure, R>;
  readonly vacuum: () => Effect.Effect<VacuumVerdict, StoreFailure>;
  readonly adopted: Effect.Effect<boolean>;
  readonly freeing: <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.Effect<readonly [A, number], E | StoreFailure, R>;
  readonly moves: TableMoves;
  readonly stalled: Effect.Effect<WriterStall | null>;
};

export const IN_MEMORY = ':memory:';

export const storeDirectory = (storePath: string): string => dirname(storePath);

export const dataPathOf = (storePath: string): string | null => (storePath === IN_MEMORY ? null : storeDirectory(storePath));

export class MachineStore extends Context.Service<MachineStore, Store<'machine'>>()('tagma/platform/MachineStore') {}

export class GraphStore extends Context.Service<GraphStore, Store<'graph'>>()('tagma/platform/GraphStore') {}
