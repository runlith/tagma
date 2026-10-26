import { pageRows } from '@runlith/paging';
import { said } from '../../platform/contract/service/presentation.js';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { body, pair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { reachOf } from '../../projects/reach.js';
import { Conversations } from '../contract/service/conversations.js';
import { CONVERSATION_HITS, SEARCH_OPERATIONS as OPS } from '../contract/wire/operations/search.js';
import { harnessRefusal } from '../refusals.js';
import { conversationHitsText } from '../voice/threadText.js';

const instantOf = (
  field: 'since' | 'before',
  value: string | undefined,
): Effect.Effect<number | undefined, GateRefusal<'selection-shape'>> => {
  if (value === undefined) return Effect.succeed(undefined);
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? Effect.fail(
        new GateRefusal('selection-shape', `\`${field}\` is not an ISO instant: ${value}.`, [
          'name an ISO instant, e.g. 2026-10-02T00:00:00+02:00',
        ]),
      )
    : Effect.succeed(ms);
};

export const SEARCH_PAIRS = {
  search_threads: pair(
    OPS.search_threads,
    body(OPS.search_threads, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const page = yield* harnessRefusal(
          Effect.gen(function* () {
            const since = yield* instantOf('since', input.since);
            const before = yield* instantOf('before', input.before);
            return yield* (yield* Conversations).search(
              caller.actor.kind === 'thread' ? { kind: 'thread', threadId: caller.actor.threadId } : { kind: 'operator' },
              {
                query: input.query,
                scope: yield* reachOf(input.projects),
                since,
                before,
                threadId: input.threadId,
                limit: pageRows(input.limit, CONVERSATION_HITS, ceilingOf(CONVERSATION_HITS)),
                cursor: input.cursor,
              },
            );
          }),
          OPS.search_threads.refusals,
        ).pipe(
          Effect.catchTag('BodyMissing', (missing) => Effect.fail(new GateRefusal('selection-shape', missing.reason, missing.unblock))),
        );
        return {
          status: 'ok' as const,
          matches: page.matches,
          total: page.tally.total,
          atLeast: page.tally.atLeast,
          totalCut: page.tally.cut,
          coverage: page.coverage,
          excluded: page.excluded,
          cut: page.cut,
          cursor: page.cursor,
          approximate: page.approximate ? (true as const) : undefined,
        };
      }),
      voice: said(conversationHitsText),
    }),
  ),
};
