import { and, eq, exists, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { WorkSpells } from '../../thread-record/contract/service/spells.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ModelChanges } from '../../threads/contract/service/modelChanges.js';
import { externalSession, leased, sessionFacts, sessionValues } from '../../threads/store/harnessFacet.js';
import { inProgram } from '../../platform/store/crossing.js';
import { programOf, programWriteUnit } from '../../platform/store/programs.js';
import { bindQuery } from '../../platform/store/queries.js';
import { nativeRows, thread, threadRun, unparkedRun } from '../../threads/store/kernel.js';
import { askedOf, bindingOf, capabilitiesOf, chooseModel, roadOf, switchesOf } from '../../threads/store/seat.js';
import { parseExternalSession } from '../../threads/contract/wire/harness/externalSession.js';
import { readExternalSession, writeSession } from '../session.js';
import { SessionRows, type StandingSession } from '../contract/service/sessionRows.js';

export const makeSessionRows = Effect.fnUntraced(function* ({ db }: { readonly db: StoreDb<'machine'> }) {
  const kinds = yield* ThreadEntryKinds;
  const units = yield* MachineUnits;
  const spells = yield* WorkSpells;
  const records = yield* ThreadRecords;
  const models = yield* ModelChanges;
  const adapterOf = (transport: string) =>
    exists(
      db
        .select({ id: thread.id })
        .from(thread)
        .where(and(eq(thread.id, externalSession.id), sql`json_extract(${thread.transport}, '$.adapter') = ${transport}`)),
    );
  const heldSession = db
    .select({ id: externalSession.id })
    .from(externalSession)
    .where(
      and(
        eq(externalSession.id, sql.placeholder('id')),
        eq(externalSession.facet, sql.param(sql.placeholder('facet'), externalSession.facet)),
        sql`${externalSession.leaseOwner} is ${sql.placeholder('leaseOwner')}`,
      ),
    )
    .prepare();
  const changing = writes('HarnessSessionStore.change', [sessionFacts], records.writes, spells.writes);
  const beating = writes('HarnessSessionStore.beat', [sessionFacts]);
  const choosing = writes('HarnessSessionStore.choose', [nativeRows]);
  return SessionRows.of({
    inspect: (work) => units.read(work),
    within: (operation, work) => units.write(operation, work),
    planned: (operation, identity, work) =>
      inProgram(units, operation, identity, 'HarnessSessionStore.planned', (program) => work(programWriteUnit(program))),
    held: (id, facet, unit) => {
      const program = programOf(unit);
      if (program === null) return Effect.void;
      const values = sessionValues(facet);
      return program.guard(bindQuery(heldSession, { id, facet: values.facet, leaseOwner: values.leaseOwner }), 1);
    },
    writes: changing,
    choosing,
    read: (id, unit) => readExternalSession(db, unit, id),
    write: (id, facet, unit) => {
      if (programOf(unit) === null) return writeSession(db, unit, id, facet);
      const values = sessionValues(facet);
      return Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.asVoid(
          unit.run(
            db
              .update(externalSession)
              .set({
                facet: values.facet,
                leaseOwner: values.leaseOwner,
                leaseBeat: values.leaseBeat === null ? null : undefined,
                updatedAt: new Date(now),
              })
              .where(eq(externalSession.id, id)),
          ),
        ),
      );
    },
    sessionsStanding: (transport) =>
      units.read((unit) =>
        Effect.gen(function* () {
          const rows = yield* unit.run(
            db
              .select({
                id: externalSession.id,
                facet: externalSession.facet,
                leaseOwner: externalSession.leaseOwner,
                leaseBeat: externalSession.leaseBeat,
                running: sql<number>`exists (select 1 from ${threadRun} where ${threadRun.threadId} = ${externalSession.id} and ${threadRun.status} = 'running')`,
              })
              .from(externalSession)
              .where(and(isNotNull(externalSession.leaseBeat), adapterOf(transport))),
          );
          const standing: StandingSession[] = [];
          for (const row of rows) {
            const read = yield* Effect.result(
              Effect.try({ try: () => parseExternalSession(leased(row.facet, row)), catch: (cause) => cause }),
            );
            if (read._tag === 'Failure' || read.success === null) {
              yield* Effect.logWarning('a standing external session could not be read; its next use reads it again', {
                threadId: row.id,
                cause: read._tag === 'Failure' ? read.failure : 'missing',
              });
              continue;
            }
            standing.push({ threadId: row.id, facet: read.success, running: Number(row.running) === 1 });
          }
          return standing;
        }),
      ),
    standing: (transport) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: externalSession.id })
              .from(externalSession)
              .where(and(isNotNull(externalSession.leaseBeat), adapterOf(transport))),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),
    parked: (ids) =>
      ids.length === 0
        ? Effect.succeed(false)
        : units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ id: threadRun.id })
                  .from(threadRun)
                  .where(and(inArray(threadRun.id, [...ids]), eq(threadRun.status, 'running'), sql`not ${unparkedRun}`))
                  .get(),
              ),
              (row) => row !== undefined,
            ),
          ),
    ended: (ids) =>
      ids.length === 0
        ? Effect.succeed(false)
        : units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({ id: threadRun.id })
                  .from(threadRun)
                  .where(and(inArray(threadRun.id, [...ids]), ne(threadRun.status, 'running')))
                  .get(),
              ),
              (row) => row !== undefined,
            ),
          ),
    activeAt: (id) =>
      units.read((unit) =>
        Effect.map(
          unit.run(db.select({ at: externalSession.activeAt }).from(externalSession).where(eq(externalSession.id, id)).get()),
          (row) => row?.at ?? 0,
        ),
      ),
    beat: (ownerId, transport, active) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        units.write(beating, (unit) =>
          Effect.map(
            unit.run(
              db
                .update(externalSession)
                .set({
                  leaseBeat: now,
                  activeAt:
                    active.length === 0
                      ? undefined
                      : sql`case when ${externalSession.id} in (${sql.join(
                          active.map((id) => sql`${id}`),
                          sql`, `,
                        )}) then ${now} else ${externalSession.activeAt} end`,
                })
                .where(and(eq(externalSession.leaseOwner, ownerId), isNotNull(externalSession.leaseBeat), adapterOf(transport)))
                .returning({ id: externalSession.id })
                .all(),
            ),
            (rows) => rows.map((row) => row.id),
          ),
        ),
      ),
    asked: (id, unit) => askedOf(db, unit, id),
    ranOn: (id) =>
      units.read((unit) =>
        Effect.map(
          unit.run(db.select({ model: threadRun.model, reasoning: threadRun.reasoning }).from(threadRun).where(eq(threadRun.id, id)).get()),
          (row) => (row === undefined || row.model === null ? undefined : { model: row.model, reasoning: row.reasoning }),
        ),
      ),
    threadOfRun: (id) =>
      units.read((unit) =>
        Effect.map(
          unit.run(db.select({ threadId: threadRun.threadId }).from(threadRun).where(eq(threadRun.id, id)).get()),
          (row) => row?.threadId ?? null,
        ),
      ),
    road: (id) => units.read((unit) => roadOf(db, kinds, unit, id)),
    choose: (id, asked, switches, account, unit) =>
      models.record(unit, id, asked ?? {}, chooseModel(db, unit, id, asked, switches, account)),
    switches: (id, unit) => switchesOf(db, unit, id),
    capabilities: (id) => units.read((unit) => capabilitiesOf(db, kinds, unit, id)),
    binding: (id, unit) => bindingOf(db, kinds, unit, id),
  });
});
