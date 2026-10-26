import { and, eq, inArray, sql } from 'drizzle-orm';
import { Effect, type Context } from 'effect';
import * as Schema from 'effect/Schema';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { Holding } from '../contract/wire/holdings.js';
import type { Holder } from '../../workspace/contract/wire/checkout.js';
import { LineEndReason, type LineEnd, type ThreadEntry } from '../contract/wire/threadChanges.js';
import { workspaceChange } from '../store/tables.js';
import { readHolder } from '../store/homes.js';

const mine = (holder: Holder, thread: string): boolean => holder.kind === 'thread' && holder.thread === thread;

export const entryOf = (holding: Holding, thread: string): ThreadEntry | null => {
  const verdict = holding.verdict;
  if (verdict.verdict === 'unknown')
    return verdict.writers.some((writer) => mine(writer, thread))
      ? { section: 'unproven', path: holding.path, from: holding.from, git: holding.git, reason: verdict.reason, writers: verdict.writers }
      : null;
  const hand = verdict.hands.find((one) => mine(one.holder, thread));
  if (hand === undefined) return null;
  const lines = holding.lines === 'unweighed' ? 'unweighed' : { added: hand.added, removed: hand.removed };
  if (holding.git === 'ignored') return { section: 'outside', path: holding.path, lines, writing: hand.writing };
  return {
    section: 'uncommitted',
    path: holding.path,
    from: holding.from,
    git: holding.git,
    lines,
    writing: hand.writing,
    others: verdict.hands.filter((one) => !mine(one.holder, thread)).map((one) => ({ holder: one.holder, retired: one.retired })),
    nobody: verdict.nobody.some((one) => one.added + one.removed > 0),
  };
};

export type Ended = { readonly ends: readonly LineEnd[]; readonly stamp: string };

const isEnd = Schema.is(LineEndReason);

export const endedOf = (
  units: MachineUnits['Service'],
  store: Context.Service.Shape<typeof MachineStore>,
  projectId: number,
  threadId: string,
): Effect.Effect<Ended, StoreFailure> =>
  readHolder(units, store, threadId, (unit) =>
    Effect.map(
      unit.run(
        store.db
          .select({
            state: workspaceChange.state,
            reason: workspaceChange.reason,
            rows: sql<number>`count(*)`,
            paths: sql<number>`count(distinct ${workspaceChange.checkout} || char(0) || ${workspaceChange.path})`,
            last: sql<number | null>`max(coalesce(${workspaceChange.committedAt}, ${workspaceChange.withdrawnAt}))`,
          })
          .from(workspaceChange)
          .where(
            and(
              eq(workspaceChange.holderProjectId, projectId),
              eq(workspaceChange.holder, threadId),
              inArray(workspaceChange.state, ['committed', 'withdrawn']),
            ),
          )
          .groupBy(workspaceChange.state, workspaceChange.reason),
      ),
      (rows) => ({
        ends: rows.flatMap((row) =>
          row.state === 'withdrawn' && row.reason !== null && isEnd(row.reason) ? [{ reason: row.reason, paths: Number(row.paths) }] : [],
        ),
        stamp: rows.map((row) => `${row.state}:${row.reason}:${row.rows}:${row.last}`).join('|'),
      }),
    ),
  );
