import { mintCursor, type PageQuestion, pageRows, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { cursorRefusal } from '../platform/contract/wire/refusal.js';
import { Schedules } from './contract/service/schedules.js';
import { SCHEDULE_OPERATIONS as OPS, SCHEDULE_ROWS, type ScheduleOperationId } from './contract/wire/schedule.js';

const QUESTION: PageQuestion = { operation: 'read_schedules', selection: {}, order: SCHEDULE_ROWS.order };
const CEILING = ceilingOf(SCHEDULE_ROWS);

export const SCHEDULE_PAIRS: { readonly [K in ScheduleOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_schedules: pair(
    OPS.read_schedules,
    body(OPS.read_schedules, {
      execute: Effect.fnUntraced(function* (input) {
        const read = input.cursor === undefined ? null : readCursor(input.cursor, QUESTION);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const [owner, name] = read === null ? [] : read.at;
        if (read !== null && (typeof owner !== 'string' || typeof name !== 'string' || read.at.length !== 2)) {
          return yield* cursorRefusal('bad-cursor');
        }
        const page = yield* (yield* Schedules).read({
          after: typeof owner === 'string' && typeof name === 'string' ? { owner, name } : null,
          limit: pageRows(input.limit, SCHEDULE_ROWS, CEILING),
        });
        const last = page.rows[page.rows.length - 1];
        return {
          status: 'read' as const,
          schedules: page.rows,
          shown: page.rows.length,
          total: page.total,
          next: last !== undefined && page.more ? mintCursor(QUESTION, [last.owner, last.name]) : null,
          complete: true,
        };
      }),
    }),
  ),
};
