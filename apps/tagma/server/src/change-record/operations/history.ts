import { Effect, Schema } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { walks } from '../../platform/contract/wire/refusal.js';
import { pageRows } from '@runlith/paging';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { isRootFailure } from '../../workspace/contract/wire/roots.js';
import { entryOf } from '../changes/entries.js';
import { type JudgedPaths, standingTurn } from '../changes/turns.js';
import { Holdings } from '../contract/service/holdings.js';
import { ChangeRecord, type Turns } from '../contract/service/record.js';
import { ChangeScope } from '../contract/service/scope.js';
import { CHANGE_READS as OPS } from '../contract/wire/operations.js';
import { THREAD_HISTORY } from '../contract/wire/pages.js';
import { outcomeRefusal } from '../record/outcomes.js';

const HISTORY_WALK = {
  operation: 'read_thread_history',
  order: THREAD_HISTORY.order,
  selection: Schema.Struct({ projectId: Schema.Number, threadId: Schema.String }),
  key: Schema.Tuple([Schema.Number, Schema.String]),
};

type Row = Turns['rows'][number];

const judgedOf = Effect.fn('read_thread_history.judged')(function* (rows: readonly Row[], threadId: string) {
  const holdings = yield* Holdings;
  const judged = new Map<string, ReadonlySet<string>>();
  for (const checkout of new Set(rows.flatMap((row) => (row.state === 'held' ? [row.checkout] : [])))) {
    const view = yield* holdings.read(RootId.make(checkout)).pipe(Effect.catchIf(isRootFailure, () => Effect.succeed(null)));
    if (view === null || view.state.kind !== 'current') continue;
    judged.set(checkout, new Set(view.paths.flatMap((holding) => (entryOf(holding, threadId) === null ? [] : [holding.path]))));
  }
  return judged satisfies JudgedPaths;
});

export const readThreadHistory = pair(
  OPS.read_thread_history,
  body(OPS.read_thread_history, {
    execute: Effect.fn('read_thread_history')(function* (input) {
      const projectId = yield* (yield* ChangeScope).projectId;
      const record = yield* ChangeRecord;
      const read = yield* walks.page({
        walk: HISTORY_WALK,
        selection: { projectId, threadId: input.threadId },
        cursor: input.cursor,
        asked: pageRows(input.limit, THREAD_HISTORY, ceilingOf(THREAD_HISTORY)),
        keyOf: (row: Row) => [row.at, row.key] as const,
        read: (after, rows) =>
          record
            .turns({
              projectId,
              threadId: input.threadId,
              limit: rows,
              after: after === undefined ? undefined : { at: after[0], key: after[1] },
            })
            .pipe(Effect.catchTag('OutcomeUnread', (failure) => Effect.fail(outcomeRefusal(failure)))),
      });
      const judged = yield* judgedOf(read.rows, input.threadId);
      return {
        status: 'ok' as const,
        turns: read.rows.map(({ key: _key, ...turn }) => standingTurn(turn, judged)),
        total: read.total,
        next: read.next,
      };
    }),
  }),
);
