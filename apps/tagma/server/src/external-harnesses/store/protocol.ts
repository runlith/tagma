import { eq, sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect, Schema } from 'effect';
import { threadRecord } from '../../thread-record/store/table.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits, Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { thread } from '../../threads/store/kernel.js';
import { declareCapabilities, type DeclaredByAgent } from '../../threads/store/seat.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { ProtocolRow } from '../protocol/row.js';

export const protocolSession = sqliteTable('protocol_session', {
  id: text('id')
    .primaryKey()
    .references(() => threadRecord.id, { onDelete: 'cascade' }),
  row: text('row', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

const decodeRow = Schema.decodeUnknownResult(ProtocolRow);
const encodeRow = Schema.encodeSync(ProtocolRow);

export class ProtocolRows {
  readonly writes = writes('ProtocolRows.write', [protocolSession]);

  constructor(
    private readonly db: StoreDb<'machine'>,
    private readonly units: MachineUnits['Service'],
  ) {}

  declare(threadId: string, declared: DeclaredByAgent): Effect.Effect<void, StoreFailure> {
    return this.units.write(writes('ProtocolRows.declare', [thread]), (unit) => declareCapabilities(this.db, unit, threadId, declared));
  }

  load(threadId: string): Effect.Effect<ProtocolRow | null, StoreFailure | GateRefusal> {
    return this.units.read((unit) => this.read(unit, threadId));
  }

  read(unit: Unit<'machine'>, threadId: string): Effect.Effect<ProtocolRow | null, StoreFailure | GateRefusal> {
    return Effect.flatMap(
      unit.run(this.db.select({ row: protocolSession.row }).from(protocolSession).where(eq(protocolSession.id, threadId)).get()),
      (stored) => {
        if (stored === undefined) return Effect.succeed(null);
        const decoded = decodeRow(stored.row);
        return decoded._tag === 'Success'
          ? Effect.succeed(decoded.success)
          : new GateRefusal('session-unreadable', `The protocol row of ${threadId} cannot be read: ${decoded.failure.message}`, [
              'inspect the stored protocol session',
            ]);
      },
    );
  }

  write(unit: Unit<'machine'>, threadId: string, row: ProtocolRow): Effect.Effect<void, StoreFailure> {
    const encoded = encodeRow(row);
    return Effect.asVoid(
      unit.run(
        this.db
          .insert(protocolSession)
          .values({ id: threadId, row: encoded })
          .onConflictDoUpdate({ target: protocolSession.id, set: { row: sql`excluded.row`, updatedAt: sql`excluded.updated_at` } }),
      ),
    );
  }

  drop(unit: Unit<'machine'>, threadId: string): Effect.Effect<void, StoreFailure> {
    return Effect.asVoid(unit.run(this.db.delete(protocolSession).where(eq(protocolSession.id, threadId))));
  }
}
