import { Context, type Effect } from 'effect';
import type { QueuedCommit, CommitRecordFailed } from '../../commits/queue.js';

export class CommitRecords extends Context.Service<
  CommitRecords,
  { record(queued: QueuedCommit): Effect.Effect<void, CommitRecordFailed> }
>()('tagma/enforcement/CommitRecords') {}
