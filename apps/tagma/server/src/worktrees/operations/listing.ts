import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { keyOrder, page, pageRows, pastKey, readCursor, type PageKey, type PageQuestion } from '@runlith/paging';
import { WORKTREE_CLEANUP } from '../contract/wire/pages.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { CLEANUP_IDLE_DAYS, type CleanupCandidate } from '../contract/wire/cleanup.js';
import { WorktreeRows } from '../contract/service/listing.js';
import { WorktreeCleanup } from '../contract/service/cleanup.js';
import { requesterOf } from '../contract/service/requester.js';
import { finishing } from './finishing.js';
import { LISTING_OPERATIONS } from '../contract/wire/operations/listing.js';
import { RETIREMENT_OPERATIONS } from '../contract/wire/operations/retirement.js';

const CLEANUP_ORDER = ['asc', 'desc', 'asc'] as const;

const CLEANUP_RANK: Record<CleanupCandidate['reason'], number> = { merged: 0, missing: 1, idle: 2 };

const cleanupKey = (candidate: CleanupCandidate): PageKey => [CLEANUP_RANK[candidate.reason], candidate.idleDays, candidate.rootId];

const LISTING = LISTING_OPERATIONS;
const RETIRED = RETIREMENT_OPERATIONS;

export const LISTING_PAIRS = {
  list_worktrees: pair(
    LISTING.list_worktrees,
    body(LISTING.list_worktrees, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const listing = yield* WorktreeRows;
        const rows = yield* listing.list(call.project.id, {
          limit: input.limit,
          cursor: input.cursor,
        });
        return { status: 'ok' as const, worktrees: rows };
      }),
    }),
  ),

  list_worktree_cleanup: pair(
    RETIRED.list_worktree_cleanup,
    body(RETIRED.list_worktree_cleanup, {
      execute: Effect.fnUntraced(function* (input) {
        const call = yield* yield* CurrentProject;
        const idleAfterDays = input.idleAfterDays ?? CLEANUP_IDLE_DAYS;
        const question: PageQuestion = {
          operation: 'list_worktree_cleanup',
          selection: { projectId: call.project.id, idleAfterDays },
          order: WORKTREE_CLEANUP.order,
        };
        const at = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (at !== null && 'refused' in at) return yield* cursorRefusal(at.refused);
        const candidates = yield* (yield* WorktreeCleanup).candidates(call.project.id, idleAfterDays);
        const sorted = [...candidates].sort((left, right) => keyOrder(CLEANUP_ORDER)(cleanupKey(left), cleanupKey(right)));
        const rest = at === null ? sorted : pastKey(sorted, cleanupKey, CLEANUP_ORDER, at.at);
        const size = pageRows(input.limit, WORKTREE_CLEANUP, ceilingOf(WORKTREE_CLEANUP));
        const cut = page({ rows: rest.slice(0, size + 1), asked: size, keyOf: cleanupKey, question, total: sorted.length });
        const cleanup = {
          idleAfterDays,
          candidates: cut.rows,
          shown: cut.shown,
          total: sorted.length,
          next: cut.next,
          complete: cut.complete,
        };
        return { status: 'ok' as const, cleanup };
      }),
    }),
  ),

  clean_up_worktrees: pair(
    RETIRED.clean_up_worktrees,
    body(RETIRED.clean_up_worktrees, {
      prepare: Effect.fn('clean_up_worktrees.places')(function* (input) {
        const call = yield* yield* CurrentProject;
        return yield* finishing('clean_up_worktrees')((yield* WorktreeCleanup).places(call.project.id, input.rootIds));
      }),
      execute: Effect.fnUntraced(function* (input, _places, caller) {
        const call = yield* yield* CurrentProject;
        const worktrees = yield* (yield* WorktreeCleanup).clean(
          call.project.id,
          input.rootIds,
          input.idleAfterDays ?? CLEANUP_IDLE_DAYS,
          requesterOf(caller, call.project.id),
        );
        return { status: 'cleaned' as const, worktrees };
      }),
    }),
  ),
};
