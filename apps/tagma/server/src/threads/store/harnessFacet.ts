import { eq, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder, index, integer, sqliteTable, text, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { threadRecord } from '../../thread-record/store/table.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { Effect } from 'effect';
import { projectRows } from '../../platform/contract/service/projections.js';
import type { ExternalSession } from '../contract/wire/harness/externalSession.js';

export const recoverableSession = (facet: SQLiteColumn): SQL =>
  sql`json_type(${facet}, '$.session') = 'object' and json_extract(${facet}, '$.session.state') is not 'ended'`;

export const externalSession = sqliteTable(
  'external_session',
  {
    id: text('id')
      .primaryKey()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    facet: text('facet', { mode: 'json' }).$type<ExternalSession>().notNull(),
    cli: text('cli').generatedAlwaysAs(sql`json_extract(facet, '$.name')`, { mode: 'virtual' }),
    sessionKey: text('session_key').generatedAlwaysAs(sql`json_extract(facet, '$.sessionKey')`, { mode: 'virtual' }),
    leaseOwner: text('lease_owner'),
    leaseBeat: integer('lease_beat'),
    activeAt: integer('active_at'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('external_session_key_idx').on(table.cli, table.sessionKey),
    index('external_session_recover_idx').on(table.id).where(recoverableSession(table.facet)),
    index('external_session_lease_idx')
      .on(table.leaseOwner, table.leaseBeat)
      .where(sql`${table.leaseBeat} is not null`),
  ],
);

export const sessionFacts = projectRows({
  id: 'threads.session',
  table: externalSession,
  keys: ['id'],
  address: 'id',
  columns: { id: externalSession.id, facet: externalSession.facet },
});

export type SessionLease = { readonly leaseOwner: string | null; readonly leaseBeat: number | null };

export const leaseOf = (facet: ExternalSession): SessionLease => {
  const session = facet.session;
  const standing = session !== undefined && session.state !== 'ended';
  return {
    leaseOwner: standing ? (session.ownerId ?? null) : null,
    leaseBeat: standing ? Date.parse(session.heartbeatAt ?? session.startedAt) : null,
  };
};

export const unleased = (facet: ExternalSession): ExternalSession => {
  const session = facet.session;
  if (session === undefined) return facet;
  const { ownerId: _owner, heartbeatAt: _beat, ...stored } = session;
  return { ...facet, session: stored as ExternalSession['session'] };
};

export const activeOf = (facet: ExternalSession): number | null =>
  facet.session === undefined ? null : Date.parse(facet.session.startedAt);

export const sessionValues = (facet: ExternalSession): SessionLease & { readonly facet: ExternalSession } => ({
  ...leaseOf(facet),
  facet: unleased(facet),
});

export function leased(stored: ExternalSession, lease: SessionLease): ExternalSession;
export function leased(stored: unknown, lease: SessionLease): unknown;
export function leased(stored: unknown, lease: SessionLease): unknown {
  if (typeof stored !== 'object' || stored === null) return stored;
  const facet = stored as Record<string, unknown>;
  const session = facet.session;
  if (typeof session !== 'object' || session === null) return stored;
  const held = session as Record<string, unknown>;
  const beat = lease.leaseBeat ?? (typeof held.startedAt === 'string' ? Date.parse(held.startedAt) : 0);
  return { ...facet, session: { ...held, ownerId: lease.leaseOwner, heartbeatAt: new Date(beat).toISOString() } };
}

export const sessionRows = new QueryBuilder()
  .select({
    id: externalSession.id,
    facet: externalSession.facet,
    leaseOwner: externalSession.leaseOwner,
    leaseBeat: externalSession.leaseBeat,
  })
  .from(externalSession)
  .as('external_session_rows');

export const liveProcesses = (where: SQL): SQL => sql`
  select json_extract(${sessionRows.facet}, '$.session.id') as id, ${sessionRows.id} as thread_id, 'harness' as kind,
         json_extract(${sessionRows.facet}, '$.name') as harness
    from ${sessionRows}
   where ${recoverableSession(sessionRows.facet)}
     and json_extract(${sessionRows.facet}, '$.session.state') in ('starting', 'running', 'stopping', 'uncertain') and ${where}`;

export const sessionOf = (id: SQL | SQLiteColumn): SQL<ExternalSession | null> =>
  sql<ExternalSession | null>`(select ${externalSession.facet} from ${externalSession} where ${externalSession.id} = ${id})`.mapWith(
    externalSession.facet,
  );

export const insertSession = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  id: string,
  facet: ExternalSession,
): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(unit.run(db.insert(externalSession).values({ id, ...sessionValues(facet), activeAt: activeOf(facet) })));

export const deleteSession = (db: StoreDb<'machine'>, unit: Unit<'machine'>, id: string): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(unit.run(db.delete(externalSession).where(eq(externalSession.id, id))));
