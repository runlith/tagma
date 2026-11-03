import type { Table } from 'drizzle-orm';
import { Data, Effect, Option, Schema, type Context, type Scope } from 'effect';
import { ContributionPoint } from './contribution.js';
import type { StoreDb, StoreFailure } from './store.js';
import type { WriteUnit } from './units.js';

export type RegistryRow = { readonly [field: string]: unknown };

export type RegistryRestore = (unit: WriteUnit<'machine'>, db: StoreDb<'machine'>) => Effect.Effect<void, StoreFailure>;

export type RegistryPart = {
  readonly section: string;
  readonly fields: Schema.Struct.Fields;
  readonly optional?: true;
  readonly tables: readonly Table[];
  readonly dump: (db: StoreDb<'machine'>) => Effect.Effect<readonly RegistryRow[], StoreFailure>;
  readonly read: (rows: unknown) => Effect.Effect<RegistryRestore, Schema.SchemaError>;
  readonly watch?: (changed: Effect.Effect<void>) => Effect.Effect<void, never, Scope.Scope>;
};

export type RegistryOwner = { readonly id: string; readonly load: () => Promise<RegistryPart> };

export const MACHINE_REGISTRY = new ContributionPoint<RegistryOwner>('platform/machine-registry');

class RegistrySignalMissing extends Data.TaggedError('RegistrySignalMissing')<{ readonly section: string; readonly signal: string }> {
  override get message(): string {
    return `the machine registry section ${this.section} re-exports on ${this.signal}, which this server does not provide`;
  }
}

type Fields = { readonly [field: string]: Schema.Codec<unknown, unknown, never, never> };

export const registryPart = <const F extends Fields, I, S>(part: {
  readonly section: string;
  readonly fields: F;
  readonly optional?: true;
  readonly tables: readonly Table[];
  readonly dump: (db: StoreDb<'machine'>) => Effect.Effect<ReadonlyArray<Schema.Struct.Encoded<F>>, StoreFailure>;
  readonly restore: (
    unit: WriteUnit<'machine'>,
    db: StoreDb<'machine'>,
    rows: ReadonlyArray<Schema.Struct.Type<F>>,
  ) => Effect.Effect<void, StoreFailure>;
  readonly signal?: { readonly key: Context.Key<I, S>; readonly subscribe: (service: S, changed: Effect.Effect<void>) => () => void };
}): RegistryPart => {
  const decode = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct(part.fields)));
  const { signal } = part;
  return {
    section: part.section,
    fields: part.fields,
    optional: part.optional,
    tables: part.tables,
    dump: part.dump,
    read: (rows) => Effect.map(decode(rows), (read) => (unit, db) => part.restore(unit, db, read)),
    watch:
      signal === undefined
        ? undefined
        : (changed) =>
            Effect.flatMap(
              Effect.serviceOption(signal.key),
              Option.match({
                onNone: () => Effect.die(new RegistrySignalMissing({ section: part.section, signal: signal.key.key })),
                onSome: (service) =>
                  Effect.asVoid(
                    Effect.acquireRelease(
                      Effect.sync(() => signal.subscribe(service, changed)),
                      (leave) => Effect.sync(leave),
                    ),
                  ),
              }),
            ),
  };
};
