import { Schema } from 'effect';
import { COVERAGE_REFUSALS, REPOSITORY_REFUSALS, ROOT_REFUSALS } from '../../../workspace/contract/wire/refusals.js';
import { feed } from '../../../platform/contract/wire/operation.js';
import { WorktreeFeedEvent } from './rows.js';

export const WORKTREES_FEED = feed('worktrees.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    limit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    places: Schema.optional(Schema.Boolean),
  }),
  event: WorktreeFeedEvent,
  refusals: ['not-found', 'worktree-unavailable', ...COVERAGE_REFUSALS, ...ROOT_REFUSALS, ...REPOSITORY_REFUSALS],
  callers: 'operator',
  admission: 'project',
  graph: 'none',
});
