import { and, eq, inArray, isNotNull, like, notExists, notInArray, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { rootUse, rootUseHold } from '../../workspace/store/tables.js';
import { ExecutionHistory, type ForgottenHistory } from '../contract/service/history.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import { command, commandWait, openTerminal, terminal, terminalWriter } from './terminal.js';
import { queried } from './rows.js';
import { forgetReleasedUses } from './releasedUses.js';

const ROWS = 50;
const PORTION_MS = 25;
const IDS = 500;

const forgetting = writes('ExecutionHistory.portion', [command, terminal, terminalWriter, openTerminal, rootUseHold, rootUse]);

type Targets = { readonly commands: readonly string[]; readonly terminals: readonly string[] };

const ORIGIN = 'thread:';

const usesOf = (rows: readonly { readonly use: string | null }[]) => ({
  rows: rows.length,
  uses: rows.flatMap((row) => (row.use === null ? [] : [row.use])),
});

export const makeExecutionHistory = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;

  const read = <A>(work: (unit: Unit<'machine'>) => Effect.Effect<A, TerminalUnavailable>) =>
    Effect.mapError(units.read(work, { bulk: true }), (failure) =>
      failure instanceof TerminalUnavailable
        ? failure
        : new TerminalUnavailable({ owner: 'store', message: `The machine store could not answer: ${failure.message}` }),
    );

  const commandsGone = (unit: WriteUnit<'machine'>, ids: readonly string[]) =>
    Effect.map(
      queried(
        unit,
        db
          .delete(command)
          .where(
            and(
              inArray(command.executionId, [...ids]),
              notInArray(command.executionId, db.select({ id: commandWait.executionId }).from(commandWait)),
            ),
          )
          .returning({ use: command.rootUseId }),
      ),
      usesOf,
    );

  const terminalsGone = (unit: WriteUnit<'machine'>, ids: readonly string[]) =>
    Effect.map(
      queried(
        unit,
        db
          .delete(terminal)
          .where(and(inArray(terminal.executionId, [...ids]), isNotNull(terminal.dischargedAt)))
          .returning({ use: terminal.rootUseId }),
      ),
      usesOf,
    );

  const drop = Effect.fnUntraced(function* (targets: Targets) {
    const forgotten = { commands: 0, terminals: 0, holds: 0 };
    let commands = 0;
    let terminals = 0;
    while (commands < targets.commands.length || terminals < targets.terminals.length) {
      const portion = yield* Effect.mapError(
        units.write(forgetting, (unit) =>
          Effect.gen(function* () {
            const started = performance.now();
            do {
              const fromCommands = commands < targets.commands.length;
              const ids = fromCommands
                ? targets.commands.slice(commands, commands + ROWS)
                : targets.terminals.slice(terminals, terminals + ROWS);
              if (fromCommands) commands += ids.length;
              else terminals += ids.length;
              const gone = fromCommands ? yield* commandsGone(unit, ids) : yield* terminalsGone(unit, ids);
              if (fromCommands) forgotten.commands += gone.rows;
              else forgotten.terminals += gone.rows;
              forgotten.holds += yield* forgetReleasedUses(db, unit, gone.uses);
            } while (
              performance.now() - started < PORTION_MS &&
              (commands < targets.commands.length || terminals < targets.terminals.length)
            );
            return performance.now() - started;
          }),
        ),
        (failure) =>
          failure instanceof TerminalUnavailable
            ? failure
            : new TerminalUnavailable({ owner: 'store', message: `The machine store could not forget history: ${failure.message}` }),
      );
      if (commands < targets.commands.length || terminals < targets.terminals.length) yield* Effect.sleep(Math.max(PORTION_MS, portion));
    }
    return forgotten satisfies ForgottenHistory;
  });

  const releasedUses = Effect.fnUntraced(function* () {
    let after = 0;
    const step = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>) {
      const uses = yield* queried(
        unit,
        db.all<{ readonly at: number; readonly id: string }>(
          sql`select rowid as at, use_id as id from ${rootUse} where rowid > ${after} order by rowid limit ${ROWS}`,
        ),
      );
      if (uses.length === 0) return { removed: 0, more: false };
      after = uses[uses.length - 1]!.at;
      const removed = yield* forgetReleasedUses(
        db,
        unit,
        uses.map((use) => use.id),
      );
      return { removed, more: true };
    });
    let removed = 0;
    while (true) {
      const portion = yield* Effect.mapError(
        units.write(forgetting, (unit) =>
          Effect.gen(function* () {
            const started = performance.now();
            let count = 0;
            let more = true;
            do {
              const taken = yield* step(unit);
              count += taken.removed;
              more = taken.more;
            } while (more && performance.now() - started < PORTION_MS);
            return { count, done: !more, heldMs: performance.now() - started };
          }),
        ),
        (failure) =>
          failure instanceof TerminalUnavailable
            ? failure
            : new TerminalUnavailable({
                owner: 'store',
                message: `The machine store could not forget released holds: ${failure.message}`,
              }),
      );
      removed += portion.count;
      if (portion.done) return removed;
      yield* Effect.sleep(Math.max(PORTION_MS, portion.heldMs));
    }
  });

  return ExecutionHistory.of({
    forgetThreads: Effect.fnUntraced(
      function* (threadIds) {
        const commands: string[] = [];
        const terminals: string[] = [];
        for (let at = 0; at < threadIds.length; at += IDS) {
          const ids = threadIds.slice(at, at + IDS);
          const found = yield* read((unit) =>
            Effect.all([
              queried(
                unit,
                db
                  .select({ id: command.executionId })
                  .from(command)
                  .where(
                    and(
                      inArray(command.ownerThread, ids),
                      notInArray(command.executionId, db.select({ id: commandWait.executionId }).from(commandWait)),
                    ),
                  )
                  .all(),
              ),
              queried(
                unit,
                db
                  .select({ id: terminal.executionId })
                  .from(terminal)
                  .where(
                    and(
                      inArray(
                        terminal.origin,
                        ids.map((id) => `${ORIGIN}${id}`),
                      ),
                      isNotNull(terminal.dischargedAt),
                    ),
                  )
                  .all(),
              ),
            ]),
          );
          for (const row of found[0]) commands.push(row.id);
          for (const row of found[1]) terminals.push(row.id);
        }
        return yield* drop({ commands, terminals });
      },
      (effect, threadIds) => Effect.withSpan(effect, 'ExecutionHistory.forgetThreads', { attributes: { threads: threadIds.length } }),
    ),
    forgetGone: Effect.fn('ExecutionHistory.forgetGone')(function* () {
      const [commands, terminals] = yield* read((unit) =>
        Effect.all([
          queried(
            unit,
            db
              .select({ id: command.executionId })
              .from(command)
              .where(
                and(
                  isNotNull(command.ownerThread),
                  notExists(db.select({ id: threadRecord.id }).from(threadRecord).where(eq(threadRecord.id, command.ownerThread))),
                  notInArray(command.executionId, db.select({ id: commandWait.executionId }).from(commandWait)),
                ),
              )
              .all(),
          ),
          queried(
            unit,
            db
              .select({ id: terminal.executionId })
              .from(terminal)
              .where(
                and(
                  like(terminal.origin, `${ORIGIN}%`),
                  isNotNull(terminal.dischargedAt),
                  notExists(
                    db
                      .select({ id: threadRecord.id })
                      .from(threadRecord)
                      .where(eq(threadRecord.id, sql`substr(${terminal.origin}, ${ORIGIN.length + 1})`)),
                  ),
                ),
              )
              .all(),
          ),
        ]),
      );
      const forgotten = yield* drop({ commands: commands.map((row) => row.id), terminals: terminals.map((row) => row.id) });
      return { ...forgotten, holds: forgotten.holds + (yield* releasedUses()) };
    }),
  });
});
