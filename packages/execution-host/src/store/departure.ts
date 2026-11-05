import { eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { Data, Effect, Schema } from 'effect';
import type { ExecutionId, ExecutionRef } from '@runlith/executions/protocol/execution';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { StoredEcho } from '../db/persisted';
import { executionDeparture as departureTable } from '../db/schema';
import type { InputCarry } from '../ExecutionInput';
import type { PendingEcho } from '../holder/Holder';
import { Descendant } from '../ProvenSet';
import type { OpenedStore } from './ExecutionStore';
import { StoredExecutionMissing } from './errors';
import { continuation, type Applied } from './migrationChain';
import { unreadable } from './records';

export type Departure = {
  readonly input: InputCarry | undefined;
  readonly parsed: ByteOffset | undefined;
  readonly descendants: ReadonlyArray<Descendant>;
  readonly echoes: ReadonlyArray<PendingEcho>;
};

export type Departed = { readonly execution: ExecutionRef; readonly departure: Departure };

export class DepartureLost extends Data.TaggedError('DepartureLost')<{
  readonly execution: string;
  readonly detail: string;
}> {}

const decodeOffset = Schema.decodeUnknownEffect(ByteOffset);
const decodeDescendants = Schema.decodeUnknownEffect(Schema.Array(Descendant));
const decodeEchoes = Schema.decodeUnknownEffect(Schema.Array(StoredEcho));

export const departures = (store: OpenedStore) => {
  const { db, unit, owns, executionRow } = store;

  const written = (values: typeof departureTable.$inferInsert) =>
    db.insert(departureTable).values(values).onConflictDoUpdate({ target: departureTable.executionId, set: values });

  const recordDeparture = ({ execution, departure }: Departed) =>
    unit(
      Effect.gen(function* () {
        const row = yield* executionRow(execution.execution);
        if (row === undefined) return yield* new StoredExecutionMissing({ execution: execution.execution });
        const mismatch = owns(execution, row.incarnation);
        if (mismatch !== undefined) return yield* mismatch;
        yield* written({
          executionId: execution.execution,
          accepted: departure.input?.accepted ?? null,
          remainder: departure.input === undefined ? null : Buffer.from(departure.input.remainder),
          ended: departure.input?.ended ?? null,
          parsed: departure.parsed ?? null,
          descendants: departure.descendants,
          echoes: departure.echoes.map((echo) => ({ ...echo, bytes: [...echo.bytes] })),
          lost: null,
        });
      }),
    );

  const recordLoss = (execution: ExecutionId, detail: string) =>
    unit(
      written({
        executionId: execution,
        accepted: null,
        remainder: null,
        ended: null,
        parsed: null,
        descendants: [],
        echoes: [],
        lost: detail,
      }),
    );

  const departureOf = (execution: ExecutionId) =>
    unit(
      Effect.gen(function* () {
        const row = (yield* db.select().from(departureTable).where(eq(departureTable.executionId, execution)).limit(1))[0];
        if (row === undefined) return undefined;
        if (row.lost !== null) return yield* new DepartureLost({ execution, detail: row.lost });
        const fail = unreadable('execution_departure', execution);
        const input: InputCarry | undefined =
          row.accepted === null || row.remainder === null
            ? undefined
            : {
                accepted: yield* decodeOffset(row.accepted).pipe(Effect.mapError(fail)),
                remainder: new Uint8Array(row.remainder),
                ended: row.ended === true,
              };
        return {
          input,
          parsed: row.parsed === null ? undefined : yield* decodeOffset(row.parsed).pipe(Effect.mapError(fail)),
          descendants: yield* decodeDescendants(row.descendants).pipe(Effect.mapError(fail)),
          echoes: (yield* decodeEchoes(row.echoes).pipe(Effect.mapError(fail))).map((echo) => ({
            ...echo,
            bytes: Uint8Array.from(echo.bytes),
          })),
        } satisfies Departure;
      }),
    );

  const dropDeparture = (execution: ExecutionId) =>
    unit(Effect.asVoid(db.delete(departureTable).where(eq(departureTable.executionId, execution))));

  const continuedBy = Effect.fn('ExecutionStore.continuedBy')(function* (migrations: string) {
    const chain = yield* Effect.try({
      try: () => readMigrationFiles({ migrationsFolder: migrations }),
      catch: (cause) => String(cause),
    }).pipe(Effect.result);
    if (chain._tag === 'Failure') return { _tag: 'Unread', detail: `the next migrations could not be read: ${chain.failure}` } as const;
    const applied = yield* unit(db.all<Applied>(sql`select name, hash from __drizzle_migrations order by created_at, id`));
    return continuation(applied, chain.success);
  });

  return { recordDeparture, recordLoss, departureOf, dropDeparture, continuedBy };
};
