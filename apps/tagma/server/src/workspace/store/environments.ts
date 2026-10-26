import { eq } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { environment } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { EnvironmentIdentity, type EnvironmentKind } from '../contract/wire/environments.js';

export class EnvironmentRecordUnreadable extends Data.TaggedError('EnvironmentRecordUnreadable')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `The environment record ${this.key} cannot be read: ${cause}`;
  }
}

export type EnvironmentStoreFailure = StoreFailure | EnvironmentRecordUnreadable;

const decodeIdentity = Schema.decodeUnknownEffect(EnvironmentIdentity);

const record = Effect.fn('EnvironmentStore.record')(
  (row: typeof environment.$inferSelect) => decodeIdentity(row),
  (work, row) => Effect.mapError(work, (cause) => new EnvironmentRecordUnreadable({ key: row.environmentId, cause })),
);

export type EnvironmentStore = ReturnType<typeof makeEnvironmentStore>;

export const makeEnvironmentStore = ({ db }: { readonly db: StoreDb<'machine'> }) => {
  const singleton = Effect.fn('EnvironmentStore.singleton')(function* (kind: EnvironmentKind, unit: Unit<'machine'>) {
    const row = yield* unit.run(db.select().from(environment).where(eq(environment.kind, kind)).get());
    return row === undefined ? null : yield* record(row);
  });

  const adoptSingleton = Effect.fn('EnvironmentStore.adoptSingleton')(function* (
    identity: EnvironmentIdentity,
    unit: WriteUnit<'machine'>,
  ) {
    const inserted = yield* unit.run(
      db
        .insert(environment)
        .values({
          environmentId: identity.environmentId,
          kind: identity.kind,
          namespaceId: identity.namespaceId,
        })
        .onConflictDoNothing()
        .returning({ environmentId: environment.environmentId })
        .all(),
    );
    if (inserted.length > 0) return identity;
    return yield* singleton(identity.kind, unit);
  });

  return { singleton, adoptSingleton };
};
