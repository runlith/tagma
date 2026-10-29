import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import type { Unit } from '../../platform/contract/service/units.js';
import { threadInbox } from './tables.js';

export const makeEndingSignals = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  return {
    queued: (unit: Unit<'machine'>, types: ReadonlySet<string>, threads: readonly string[] | undefined) =>
      threads?.length === 0 || types.size === 0
        ? Effect.succeed<readonly string[]>([])
        : Effect.map(
            unit.run(
              db
                .selectDistinct({ thread: threadInbox.threadId })
                .from(threadInbox)
                .where(
                  and(
                    isNull(threadInbox.deliveredToRunId),
                    eq(threadInbox.state, 'queued'),
                    eq(threadInbox.kind, 'signal'),
                    inArray(sql`json_extract(${threadInbox.body}, '$.type')`, [...types]),
                    sql`json_extract(${threadInbox.body}, '$.waits') is null`,
                    threads === undefined ? undefined : inArray(threadInbox.threadId, [...threads]),
                  ),
                )
                .all(),
            ),
            (rows): readonly string[] => rows.map((row) => row.thread),
          ),
  };
});
