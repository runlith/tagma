import { stat } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { Effect, Result } from 'effect';
import {
  reversed,
  ThreadFormRefused,
  type ThreadEntryReader,
  type ThreadFormRecord,
  type ThreadFormStep,
} from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import type { JournalsReturned, ReturnPlan } from '../contract/service/rollouts.js';
import { inboxRows } from '../store/tables.js';
import { nativeRows, runRows } from '../store/kernel.js';
import { threadEvent } from '../store/journal.js';
import type { RolloutContext } from './rolloutContext.js';
import { rolloutFormOf } from './rolloutEntryForms.js';
import type { RolloutForm } from './rolloutEntryForms.js';
import type { RolloutForms } from './rolloutForming.js';
import { rolloutStateOf, transcriptOf } from './rolloutForms.js';
import type { ThreadUses } from './uses.js';

const PAGE = 64;

const BUSY = { kind: 'busy' } as const;

type Returned = RolloutForm | typeof BUSY;

type Returning = (value: unknown) => unknown;

const RETURNING = writes('ThreadRollout.return', [threadEvent, runRows, nativeRows, inboxRows]);

const refusalOf = (cause: unknown): ThreadFormRefused =>
  cause instanceof ThreadFormRefused ? cause : new ThreadFormRefused({ step: 'unknown', issue: String(cause) });

const parsed = (text: string): Result.Result<unknown, unknown> => {
  try {
    return Result.succeed(JSON.parse(text));
  } catch (cause) {
    return Result.fail(cause);
  }
};

const returnedColumn = Effect.fnUntraced(function* (operation: WriteSet, table: string, column: string, back: Returning) {
  const store = yield* MachineStore;
  const { db } = store;
  let after = 0;
  for (;;) {
    const last = yield* store.transaction(
      operation,
      Effect.fnUntraced(function* (unit) {
        const rows = yield* unit.run(
          db.all<{ id: number; value: string | null }>(
            sql`select rowid as id, ${sql.identifier(column)} as value from ${sql.identifier(table)} where rowid > ${after} order by rowid limit ${PAGE}`,
          ),
        );
        for (const row of rows) {
          if (row.value === null) continue;
          const held = parsed(row.value);
          if (Result.isFailure(held)) continue;
          const next = yield* Effect.try({ try: () => back(held.success), catch: refusalOf });
          if (next === held.success) continue;
          yield* unit.run(
            db.run(sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${JSON.stringify(next)} where rowid = ${row.id}`),
          );
        }
        return rows.at(-1)?.id ?? null;
      }),
    );
    if (last === null) return;
    after = last;
  }
});

const touches = (steps: readonly ThreadFormStep[], records: readonly ThreadFormRecord[]): boolean =>
  steps.some((step) => records.some((record) => step[record] !== undefined));

const tailOf =
  (form: Returning): Returning =>
  (tail) => {
    if (!Array.isArray(tail)) return tail;
    const formed = tail.map(form);
    return formed.every((entry, at) => entry === tail[at]) ? tail : formed;
  };

const changedSince = (path: string, since: number) =>
  Effect.promise(() =>
    stat(path).then(
      (standing) => standing.mtimeMs >= since,
      () => false,
    ),
  );

export const rolloutReturning = (ctx: RolloutContext, forms: RolloutForms, uses: ThreadUses) => {
  const { kinds } = ctx;

  const columns = Effect.fnUntraced(function* (steps: readonly ThreadFormStep[]) {
    const entry: Returning = (value) => kinds.formed('entry', value, steps);
    if (touches(steps, ['payload', 'entry', 'message']))
      yield* returnedColumn(RETURNING, 'thread_event', 'payload', (value) => kinds.formedEvent(value, steps));
    if (touches(steps, ['entry'])) {
      yield* returnedColumn(RETURNING, 'thread_run', 'stream_tail', tailOf(entry));
      yield* returnedColumn(RETURNING, 'native_thread', 'pending_interaction', entry);
    }
    if (touches(steps, ['reading']))
      yield* returnedColumn(RETURNING, 'native_thread', 'context_reading', (value) => kinds.formed('reading', value, steps));
    if (touches(steps, ['inbox'])) yield* returnedColumn(RETURNING, 'thread_inbox', 'body', (value) => kinds.formed('inbox', value, steps));
    const native = ctx.parts.native.folds.returned;
    for (const { table, column, record } of native.columns)
      if (touches(steps, [record])) yield* returnedColumn(native.writes, table, column, (value) => kinds.formed(record, value, steps));
  });

  return Effect.fn('ThreadRollout.returnOnto')(function* ({ carried, since }: ReturnPlan) {
    const leaving = kinds.steps.filter((step) => !carried.has(step.name));
    const onto = kinds.steps.filter((step) => carried.has(step.name)).at(-1)?.name ?? null;
    const kept = leaving.filter((step) => step.back === undefined).map((step) => step.name);
    const steps = leaving.toReversed().map(reversed);
    const answer = { threads: 0, kept, unreturned: [] as { threadId: string; reason: string }[] };
    if (leaving.length === 0) return answer satisfies JournalsReturned;
    yield* ctx.machineStore(columns(steps));
    const { db } = yield* ctx.machineStore(MachineStore);
    const threads = yield* ctx.machineStore(db.select({ id: threadRecord.id }).from(threadRecord));
    const at = since.getTime();
    for (const { id: threadId } of threads) {
      const path = yield* ctx.locate(threadId);
      const mark = (yield* rolloutFormOf(db, threadId))?.step ?? null;
      const past = mark !== null && (onto === null || mark > onto);
      const state = path === undefined ? null : yield* rolloutStateOf(path);
      const written =
        path !== undefined && ((state !== null && (yield* changedSince(state.path, at))) || (yield* changedSince(transcriptOf(path), at)));
      if (!past && !written) continue;
      const outcome = yield* ctx.inJournal(
        threadId,
        uses.rest<Returned, Effect.Error<ReturnType<RolloutForms['returnedHere']>>, never>(
          threadId,
          forms.returnedHere(threadId, path, steps, past ? onto : mark),
          BUSY,
        ),
      );
      if (outcome.kind === 'refused') answer.unreturned.push({ threadId, reason: outcome.refusal.reason });
      else if (outcome.kind === 'busy') answer.unreturned.push({ threadId, reason: 'the thread was in use' });
      else answer.threads += 1;
    }
    return answer satisfies JournalsReturned;
  });
};
