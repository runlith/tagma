import { stat } from 'node:fs/promises';
import { gt, isNotNull, sql } from 'drizzle-orm';
import { Effect, Result } from 'effect';
import { reversed, ThreadFormRefused, type ThreadFormRecord, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import type { JournalsReturned, ReturnPlan } from '../contract/service/rollouts.js';
import { inboxRows } from '../store/tables.js';
import { nativeRows, runRows } from '../store/kernel.js';
import { threadEvent, threadRolloutForm } from '../store/journal.js';
import type { ReturnedColumn } from './rolloutMeta.js';
import type { RolloutContext } from './rolloutContext.js';
import { rolloutFormOf } from './rolloutEntryForms.js';
import type { RolloutForm } from './rolloutEntryForms.js';
import type { RolloutForms } from './rolloutForming.js';
import { rolloutStateOf, transcriptOf } from './rolloutForms.js';
import type { ThreadUses } from './uses.js';

const PAGE = 256;

const BUSY = { kind: 'busy' } as const;

type Returned = RolloutForm | typeof BUSY;

type Returning = (value: unknown) => unknown;

type Unreturned = JournalsReturned['unreturned'][number];

const FILE_RECORDS: readonly ThreadFormRecord[] = ['payload', 'entry', 'message', 'meta'];

const RECORDS: readonly ThreadFormRecord[] = [...FILE_RECORDS, 'reading', 'inbox'];

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

const returnedColumn = Effect.fnUntraced(function* (
  operation: WriteSet,
  { table, column, thread }: ReturnedColumn,
  holds: readonly string[] | null,
  back: Returning,
) {
  const store = yield* MachineStore;
  const { db } = store;
  const holding =
    holds === null
      ? sql`true`
      : sql.join(
          holds.map((text) => sql`instr(${sql.identifier(column)}, ${text}) > 0`),
          sql` or `,
        );
  const refused: Unreturned[] = [];
  let after = 0;
  for (;;) {
    const last = yield* store.transaction(
      operation,
      Effect.fnUntraced(function* (unit) {
        const rows = yield* unit.run(
          db.all<{ id: number; thread: string; value: string | null }>(
            sql`select rowid as id, ${sql.identifier(thread)} as thread, ${sql.identifier(column)} as value from ${sql.identifier(table)}
                where rowid > ${after} and (${holding}) order by rowid limit ${PAGE}`,
          ),
        );
        for (const row of rows) {
          if (row.value === null) continue;
          const held = parsed(row.value);
          if (Result.isFailure(held)) continue;
          const next = Result.try({ try: () => back(held.success), catch: refusalOf });
          if (Result.isFailure(next)) {
            refused.push({ threadId: row.thread, reason: next.failure.message });
            continue;
          }
          if (next.success === held.success) continue;
          yield* unit.run(
            db.run(
              sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${JSON.stringify(next.success)} where rowid = ${row.id}`,
            ),
          );
        }
        return rows.at(-1)?.id ?? null;
      }),
    );
    if (last === null) return refused;
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

  const columns = Effect.fnUntraced(function* (steps: readonly ThreadFormStep[], holds: readonly string[] | null) {
    const entry: Returning = (value) => kinds.formed('entry', value, steps);
    const refused: Unreturned[] = [];
    if (touches(steps, ['payload', 'entry', 'message']))
      refused.push(
        ...(yield* returnedColumn(RETURNING, { table: 'thread_event', column: 'payload', thread: 'thread_id' }, holds, (value) =>
          kinds.formedEvent(value, steps),
        )),
      );
    if (touches(steps, ['entry'])) {
      refused.push(
        ...(yield* returnedColumn(RETURNING, { table: 'thread_run', column: 'stream_tail', thread: 'thread_id' }, holds, tailOf(entry))),
      );
      refused.push(
        ...(yield* returnedColumn(RETURNING, { table: 'native_thread', column: 'pending_interaction', thread: 'id' }, holds, entry)),
      );
    }
    if (touches(steps, ['reading']))
      refused.push(
        ...(yield* returnedColumn(RETURNING, { table: 'native_thread', column: 'context_reading', thread: 'id' }, holds, (value) =>
          kinds.formed('reading', value, steps),
        )),
      );
    if (touches(steps, ['inbox']))
      refused.push(
        ...(yield* returnedColumn(RETURNING, { table: 'thread_inbox', column: 'body', thread: 'thread_id' }, holds, (value) =>
          kinds.formed('inbox', value, steps),
        )),
      );
    const native = ctx.parts.native.folds.returned;
    for (const { record, ...at } of native.columns)
      if (touches(steps, [record]))
        refused.push(...(yield* returnedColumn(native.writes, at, holds, (value) => kinds.formed(record, value, steps))));
    return refused;
  });

  const pastOnto = (db: StoreDb<'machine'>, onto: string | null) =>
    db
      .select({ id: threadRolloutForm.threadId })
      .from(threadRolloutForm)
      .where(onto === null ? isNotNull(threadRolloutForm.step) : gt(threadRolloutForm.step, onto));

  return Effect.fn('ThreadRollout.returnOnto')(function* ({ carried, since }: ReturnPlan) {
    const leaving = kinds.steps.filter((step) => !carried.has(step.name));
    const onto = kinds.steps.filter((step) => carried.has(step.name)).at(-1)?.name ?? null;
    const kept = leaving.filter((step) => step.back === undefined).map((step) => step.name);
    const steps = leaving.toReversed().map(reversed);
    const undeclared = leaving.some(
      ({ back }) => back !== undefined && back.holds === undefined && RECORDS.some((record) => back[record] !== undefined),
    );
    const holds = undeclared ? null : [...new Set(leaving.flatMap((step) => step.back?.holds ?? []))];
    const unreturned = new Map<string, string>();
    const answer = { threads: 0, kept, unreturned: [] as Unreturned[] };
    if (leaving.length === 0) return answer satisfies JournalsReturned;
    for (const { threadId, reason } of yield* ctx.machineStore(columns(steps, holds)))
      if (!unreturned.has(threadId)) unreturned.set(threadId, reason);
    const cast = steps.some((step) => FILE_RECORDS.some((record) => step[record] !== undefined));
    const { db } = yield* ctx.machineStore(MachineStore);
    const threads = yield* ctx.machineStore(cast ? db.select({ id: threadRecord.id }).from(threadRecord) : pastOnto(db, onto));
    const at = since.getTime();
    for (const { id: threadId } of threads) {
      const path = yield* ctx.locate(threadId);
      const mark = (yield* rolloutFormOf(db, threadId))?.step ?? null;
      const past = mark !== null && (onto === null || mark > onto);
      const state = !cast || path === undefined ? null : yield* rolloutStateOf(path);
      const written =
        cast &&
        path !== undefined &&
        ((state !== null && (yield* changedSince(state.path, at))) || (yield* changedSince(transcriptOf(path), at)));
      if (!past && !written) continue;
      const outcome = yield* ctx.inJournal(
        threadId,
        uses.rest<Returned, Effect.Error<ReturnType<RolloutForms['returnedHere']>>, never>(
          threadId,
          forms.returnedHere(threadId, path, steps, past ? onto : mark, cast),
          BUSY,
        ),
      );
      if (outcome.kind === 'refused') unreturned.set(threadId, unreturned.get(threadId) ?? outcome.refusal.reason);
      else if (outcome.kind === 'busy') unreturned.set(threadId, unreturned.get(threadId) ?? 'the thread was in use');
      else if (!unreturned.has(threadId)) answer.threads += 1;
    }
    answer.unreturned.push(...[...unreturned].map(([threadId, reason]) => ({ threadId, reason })));
    return answer satisfies JournalsReturned;
  });
};
