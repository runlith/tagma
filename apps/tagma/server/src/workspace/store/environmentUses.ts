import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { environmentUse } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import {
  EnvironmentConsumer,
  EnvironmentUse,
  type EnvironmentId,
  type EnvironmentUseId,
  type EnvironmentUseStatus,
} from '../contract/wire/environments.js';
import { writes } from '../../platform/contract/service/writes.js';

export const environmentUseWrites = writes('EnvironmentUses.write', [environmentUse]);

export class EnvironmentUseUnreadable extends Data.TaggedError('EnvironmentUseUnreadable')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    const cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `The environment use ${this.key} cannot be read: ${cause}`;
  }
}

export type EnvironmentUseStoreFailure = StoreFailure | EnvironmentUseUnreadable;

const decodeUse = Schema.decodeUnknownEffect(EnvironmentUse);
const decodeConsumer = Schema.decodeUnknownEffect(EnvironmentConsumer);

const record = Effect.fn('EnvironmentUseStore.record')(
  (row: typeof environmentUse.$inferSelect) =>
    decodeUse({
      useId: row.useId,
      consumer: { kind: row.consumerKind, id: row.consumerId },
      binding: {
        environmentId: row.environmentId,
        kind: row.kind,
        namespaceId: row.namespaceId,
        identityWitness: {
          provider: row.witnessProvider,
          format: row.witnessFormat,
          token: row.witnessToken,
        },
      },
      outcome: row.outcome,
    }),
  (work, row) => Effect.mapError(work, (cause) => new EnvironmentUseUnreadable({ key: row.useId, cause })),
);

const namedConsumers = 64;

export type EnvironmentUseStore = ReturnType<typeof makeEnvironmentUseStore>;

export const makeEnvironmentUseStore = ({ db }: { readonly db: StoreDb<'machine'> }) => {
  const byId = Effect.fn('EnvironmentUseStore.byId')(function* (useId: EnvironmentUseId, unit: Unit<'machine'>) {
    const row = yield* unit.run(db.select().from(environmentUse).where(eq(environmentUse.useId, useId)).get());
    return row === undefined ? null : yield* record(row);
  });

  const standing = Effect.fn('EnvironmentUseStore.standing')(function* (environmentId: EnvironmentId, unit: Unit<'machine'>) {
    const live = and(eq(environmentUse.environmentId, environmentId), ne(environmentUse.outcome, 'released'));
    const counted = yield* unit.run(
      db
        .select({
          uses: sql<number>`count(*)`,
          holders: sql<number>`(select count(*) from (select 1 from ${environmentUse}
            where ${live} group by ${environmentUse.consumerKind}, ${environmentUse.consumerId}))`,
        })
        .from(environmentUse)
        .where(live)
        .get(),
    );
    const uses = counted?.uses ?? 0;
    const holders = counted?.holders ?? 0;
    if (uses === 0) return { uses, holders, consumers: [] as readonly EnvironmentConsumer[] };
    const rows = yield* unit.run(
      db
        .select({
          kind: environmentUse.consumerKind,
          id: environmentUse.consumerId,
          first: sql<string>`min(${environmentUse.useId})`,
        })
        .from(environmentUse)
        .where(live)
        .groupBy(environmentUse.consumerKind, environmentUse.consumerId)
        .orderBy(asc(sql`min(${environmentUse.useId})`))
        .limit(namedConsumers)
        .all(),
    );
    const consumers = yield* Effect.forEach(rows, (row) => decodeConsumer({ kind: row.kind, id: row.id })).pipe(
      Effect.mapError((cause) => new EnvironmentUseUnreadable({ key: environmentId, cause })),
    );
    return { uses, holders, consumers };
  });

  const heldBy = Effect.fn('EnvironmentUseStore.heldBy')(function* (consumer: EnvironmentConsumer, unit: Unit<'machine'>) {
    const rows = yield* unit.run(
      db
        .select()
        .from(environmentUse)
        .where(
          and(
            eq(environmentUse.consumerKind, consumer.kind),
            eq(environmentUse.consumerId, consumer.id),
            ne(environmentUse.outcome, 'released'),
          ),
        )
        .all(),
    );
    return yield* Effect.forEach(rows, record);
  });

  const insert = Effect.fn('EnvironmentUseStore.insert')(function* (use: EnvironmentUse, unit: WriteUnit<'machine'>) {
    yield* unit.run(
      db.insert(environmentUse).values({
        useId: use.useId,
        environmentId: use.binding.environmentId,
        kind: use.binding.kind,
        namespaceId: use.binding.namespaceId,
        witnessProvider: use.binding.identityWitness.provider,
        witnessFormat: use.binding.identityWitness.format,
        witnessToken: use.binding.identityWitness.token,
        consumerKind: use.consumer.kind,
        consumerId: use.consumer.id,
        outcome: use.outcome,
      }),
    );
  });

  const outcomeStep = Effect.fn('EnvironmentUseStore.outcome')(function* (
    useId: EnvironmentUseId,
    outcome: EnvironmentUseStatus,
    unit: WriteUnit<'machine'>,
  ) {
    yield* unit.run(db.update(environmentUse).set({ outcome }).where(eq(environmentUse.useId, useId)));
  });

  return { byId, standing, heldBy, insert, outcome: outcomeStep };
};
