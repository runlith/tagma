import { type ActivityFaultCursor, ActivityFaults } from '@runlith/activity/store/faults';
import { mintCursor, pageRows, type PageQuestion, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { FAULT_ROWS } from './contract/wire/faults.js';
import { ACTIVITY_OPERATIONS as OPS, type ActivityOperationId } from './contract/wire/operations.js';
import { unreadable } from './faults.js';

const WALK: PageQuestion = { operation: 'read_faults', selection: {}, order: FAULT_ROWS.order };

const resumed = (cursor: string): Effect.Effect<ActivityFaultCursor, GateRefusal<'bad-cursor' | 'cursor-stale'>> => {
  const reading = readCursor(cursor, WALK);
  if ('refused' in reading) {
    return Effect.fail(
      new GateRefusal(reading.refused, 'the cursor is not one read_faults answered for this reading', [
        'hand back the `next` of the previous page unchanged, or read again without a cursor',
      ]),
    );
  }
  const [lastAt, fingerprint] = reading.at;
  return typeof lastAt === 'number' && typeof fingerprint === 'string'
    ? Effect.succeed({ lastAt, fingerprint })
    : Effect.fail(
        new GateRefusal('bad-cursor', 'the cursor does not name a row of the faults list', [
          'hand back the `next` of the previous page unchanged, or read again without a cursor',
        ]),
      );
};

export const ACTIVITY_PAIRS: { readonly [K in ActivityOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_faults: pair(
    OPS.read_faults,
    body(OPS.read_faults, {
      execute: Effect.fnUntraced(function* (input) {
        const after = input.cursor === undefined ? undefined : yield* resumed(input.cursor);
        const limit = pageRows(input.limit, FAULT_ROWS, ceilingOf(FAULT_ROWS));
        const page = yield* (yield* ActivityFaults).read({ limit, after }).pipe(Effect.mapError(unreadable));
        return {
          status: 'ok' as const,
          faults: page.faults,
          total: page.total,
          since: page.since,
          lost: page.lost,
          next: page.next === null ? null : mintCursor(WALK, [page.next.lastAt, page.next.fingerprint]),
        };
      }),
    }),
  ),
  clear_faults: pair(
    OPS.clear_faults,
    body(OPS.clear_faults, {
      execute: Effect.fnUntraced(
        function* () {
          yield* (yield* ActivityFaults).clear;
          return { status: 'cleared' as const };
        },
        (effect) => Effect.mapError(effect, unreadable),
      ),
    }),
  ),
};
