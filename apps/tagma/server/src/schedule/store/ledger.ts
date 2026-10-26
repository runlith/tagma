import { MachineStore } from '../../platform/contract/service/store.js';
import { and, eq, notInArray } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { Cadence, ScheduleRun, ScheduleState } from '../contract/wire/schedule.js';
import { scheduleRun } from './tables.js';

type Row = typeof scheduleRun.$inferSelect;

const stateOf = (row: Row): ScheduleState => ({
  owner: row.owner,
  name: row.name,
  everyMs: row.everyMs,
  nextAt: row.nextAt,
  running: false,
  last:
    row.lastOutcome === null || row.lastStartedAt === null || row.lastEndedAt === null
      ? null
      : {
          startedAt: row.lastStartedAt,
          endedAt: row.lastEndedAt,
          outcome: row.lastOutcome,
          reason: row.lastReason,
          skipped: row.lastSkipped ?? 0,
        },
});

export const makeLedger = Effect.gen(function* () {
  const db = (yield* MachineStore).db;
  const units = yield* MachineUnits;

  return {
    of: (owner: string) =>
      units.read((unit) =>
        Effect.map(unit.run(db.select().from(scheduleRun).where(eq(scheduleRun.owner, owner)).all()), (rows) => rows.map(stateOf)),
      ),
    replace: Effect.fn('Ledger.replace')(
      (owner: string, names: readonly string[], started: readonly (Cadence & { readonly nextAt: number })[]) =>
        units.write(writes('Ledger.replace', [scheduleRun]), (unit) =>
          Effect.gen(function* () {
            yield* unit.run(
              names.length === 0
                ? db.delete(scheduleRun).where(eq(scheduleRun.owner, owner))
                : db.delete(scheduleRun).where(and(eq(scheduleRun.owner, owner), notInArray(scheduleRun.name, [...names]))),
            );
            for (const entry of started) {
              yield* unit.run(
                db
                  .insert(scheduleRun)
                  .values({ owner, name: entry.name, everyMs: entry.everyMs, nextAt: entry.nextAt })
                  .onConflictDoUpdate({
                    target: [scheduleRun.owner, scheduleRun.name],
                    set: { everyMs: entry.everyMs, nextAt: entry.nextAt },
                  }),
              );
            }
          }),
        ),
    ),
    ended: (owner: string, name: string, nextAt: number, last: ScheduleRun) =>
      units.write(writes('Ledger.ended', [scheduleRun]), (unit) =>
        unit.run(
          db
            .update(scheduleRun)
            .set({
              nextAt,
              lastStartedAt: last.startedAt,
              lastEndedAt: last.endedAt,
              lastOutcome: last.outcome,
              lastReason: last.reason,
              lastSkipped: last.skipped,
            })
            .where(and(eq(scheduleRun.owner, owner), eq(scheduleRun.name, name))),
        ),
      ),
  };
});

export class Ledger extends Context.Service<Ledger, Effect.Success<typeof makeLedger>>()('schedule/Ledger') {}
export const ledgerLayer = Layer.effect(Ledger, makeLedger);
