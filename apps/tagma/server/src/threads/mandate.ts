import type { ThreadBindings } from '@runlith/agent/contracts';
import type { ThreadAuthority } from '@runlith/agent/thread/rows';
import type { TeamLayer } from '@runlith/agent/collaboration/team';
import { eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';
import { Clock, Effect } from 'effect';
import { MachineStore, type StoreDb, type StoreFailure } from '../platform/contract/service/store.js';
import { SignedSession } from '../platform/contract/service/writers.js';
import { parseSessionToken, sessionToken } from '../platform/contract/wire/session.js';
import type { ChangeRecord } from '../platform/contract/wire/actor.js';
import { MachineUnits, type Unit } from '../platform/contract/service/units.js';
import { ThreadMandate } from './contract/service/mandate.js';
import { writes } from '../platform/contract/service/writes.js';
import { recordsAs } from '../thread-record/facts.js';
import { mandateRows, threadMandate } from './store/mandate.js';

export type MandateWrite = {
  readonly authority?: ThreadAuthority;
  readonly delegation?: boolean | null;
  readonly delegationBy?: string | null;
  readonly delegationAt?: Date | null;
  readonly operatorNotice?: boolean | null;
  readonly approves?: readonly string[] | null;
  readonly team?: TeamLayer | null;
  readonly takenOver?: boolean;
  readonly budgetTokens?: number | null;
  readonly hostKind?: string | null;
  readonly hostId?: string | null;
  readonly bindings?: ThreadBindings;
};

export type MandateBirth = MandateWrite & {
  readonly authority: ThreadAuthority;
  readonly plain: boolean;
};

export const mandateFacts = new QueryBuilder().select(getTableColumns(threadMandate)).from(threadMandate).as('thread_mandate_facts');

export const insertMandate = (db: StoreDb<'machine'>, id: string, birth: MandateBirth): Effect.Effect<void, StoreFailure> =>
  Effect.asVoid(db.insert(threadMandate).values({ ...birth, id }));

export const writeMandate = (
  db: StoreDb<'machine'>,
  unit: Unit<'machine'>,
  id: string,
  write: MandateWrite,
): Effect.Effect<void, StoreFailure> =>
  Object.keys(write).length === 0
    ? Effect.void
    : Effect.asVoid(unit.run(db.update(threadMandate).set(write).where(eq(threadMandate.id, id))));

export type DelegationLineage = {
  readonly own: boolean | null;
  readonly nearest: { readonly allowed: boolean; readonly setAt: string } | null;
  readonly depth: number;
  readonly switched: ChangeRecord | null;
};

export type TeamLineage = {
  readonly own: TeamLayer | null;
  readonly nearest: { readonly team: TeamLayer; readonly setAt: string } | null;
};

export type ApprovesLineage = {
  readonly own: readonly string[] | null;
  readonly nearest: { readonly approves: readonly string[]; readonly setAt: string } | null;
  readonly depth: number;
};

export const makeMandateRows = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const read = <A, E>(unit: Unit<'machine'> | undefined, work: (unit: Unit<'machine'>) => Effect.Effect<A, E>) =>
    unit === undefined ? units.read(work) : work(unit);
  const lineageOf = <Row>(columns: SQL) =>
    db.all<{ id: string; depth: number } & Row>(sql`
        with recursive lineage(id, parent, depth) as (
          select tree.id, tree.parent_id, 0 from ${recordsAs('tree')} where tree.id = ${sql.placeholder('id')}
          union all
          select leaf.id, leaf.parent_id, l.depth + 1 from ${recordsAs('leaf')} join lineage l on leaf.id = l.parent
        )
        select l.id as id, ${columns}, l.depth as depth
          from lineage l left join ${mandateFacts} on ${mandateFacts.id} = l.id order by l.depth`);
  const delegations = lineageOf<{ delegation: number | null; switchedBy: string | null; switchedAt: number | null }>(
    sql`${mandateFacts.delegation} as delegation, ${mandateFacts.delegationBy} as switchedBy, ${mandateFacts.delegationAt} as switchedAt`,
  );
  const approvals = lineageOf<{ approves: string | null }>(sql`${mandateFacts.approves} as approves`);
  const teams = lineageOf<{ team: string | null }>(sql`${mandateFacts.team} as team`);
  return ThreadMandate.of({
    delegationLineage: Effect.fn('MandateRows.delegationLineage')(function* (id, tx) {
      const rows = yield* read(tx, (unit) => unit.run(delegations.execute({ id })));
      const nearest = rows.find((row) => row.delegation !== null);
      const own = rows.find((row) => row.depth === 0)?.delegation ?? null;
      let switched: ChangeRecord | null = null;
      for (const row of rows) {
        if (row.switchedAt === null || (switched !== null && switched.at >= row.switchedAt)) continue;
        const writer = row.switchedBy === null ? null : parseSessionToken(row.switchedBy);
        if (row.switchedBy !== null && writer === null) continue;
        switched = { writer, at: row.switchedAt };
      }
      return {
        own: own === null ? null : own === 1,
        nearest: nearest === undefined ? null : { allowed: nearest.delegation === 1, setAt: nearest.id },
        depth: rows.at(-1)?.depth ?? 0,
        switched,
      };
    }),
    setDelegation: Effect.fn('MandateRows.setDelegation')(function* (id, delegation) {
      const signed = yield* SignedSession;
      const delegationAt = new Date(yield* Clock.currentTimeMillis);
      const delegationBy = signed === null ? null : sessionToken(signed);
      yield* units.write(writes('MandateRows.setDelegation', [mandateRows]), (unit) =>
        writeMandate(db, unit, id, { delegation, delegationBy, delegationAt }),
      );
    }),
    approvesLineage: Effect.fn('MandateRows.approvesLineage')(function* (id, tx) {
      const rows = yield* read(tx, (unit) => unit.run(approvals.execute({ id })));
      const listed = (raw: string | null): readonly string[] | null => (raw === null ? null : (JSON.parse(raw) as readonly string[]));
      const nearest = rows.find((row) => row.approves !== null);
      return {
        own: listed(rows.find((row) => row.depth === 0)?.approves ?? null),
        nearest: nearest === undefined ? null : { approves: listed(nearest.approves) ?? [], setAt: nearest.id },
        depth: rows.at(-1)?.depth ?? 0,
      };
    }),
    setApproves: (id, approves) =>
      units.write(writes('MandateRows.setApproves', [mandateRows]), (unit) => writeMandate(db, unit, id, { approves })),
    teamLineage: Effect.fn('MandateRows.teamLineage')(function* (id, tx) {
      const rows = yield* read(tx, (unit) => unit.run(teams.execute({ id })));
      const nearest = rows.find((row) => row.team !== null);
      const own = rows.find((row) => row.depth === 0)?.team ?? null;
      return {
        own: own === null ? null : (JSON.parse(own) as TeamLayer),
        nearest: nearest?.team == null ? null : { team: JSON.parse(nearest.team) as TeamLayer, setAt: nearest.id },
      };
    }),
    setTeam: (id, team, tx) =>
      tx === undefined
        ? units.write(writes('MandateRows.setTeam', [mandateRows]), (unit) => writeMandate(db, unit, id, { team }))
        : writeMandate(db, tx, id, { team }),
    takenOver: (id, tx) =>
      read(tx, (unit) =>
        unit
          .run(db.select({ takenOver: threadMandate.takenOver }).from(threadMandate).where(eq(threadMandate.id, id)).limit(1))
          .pipe(Effect.map((rows) => rows[0]?.takenOver ?? false)),
      ),
    setTakenOver: (id, takenOver) =>
      units.write(writes('MandateRows.setTakenOver', [mandateRows]), (unit) => writeMandate(db, unit, id, { takenOver })),
    operatorNotice: (id) =>
      units.read((unit) =>
        unit
          .run(db.select({ operatorNotice: threadMandate.operatorNotice }).from(threadMandate).where(eq(threadMandate.id, id)).limit(1))
          .pipe(Effect.map((rows) => rows[0]?.operatorNotice ?? null)),
      ),
    setOperatorNotice: (id, operatorNotice) =>
      units.write(writes('MandateRows.setOperatorNotice', [mandateRows]), (unit) => writeMandate(db, unit, id, { operatorNotice })),
  });
});
