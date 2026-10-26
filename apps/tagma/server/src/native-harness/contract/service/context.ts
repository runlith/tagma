import { Context, type Effect } from 'effect';
import type { ThreadCompactAsk } from '@runlith/agent/thread/compaction/ThreadCompactionRuns';
import type { ThreadCompacted } from '@runlith/agent/thread/run/scheduler/compactions';
import type { FieldRefusal } from '../../../platform/contract/wire/refusal.js';
import type { CONTEXT_OPERATIONS } from '../wire/operations/context.js';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';
import type { ThreadInstructionsRefreshed } from '../wire/instructions.js';

export class Compaction extends Context.Service<
  Compaction,
  {
    compact(threadId: string, projectId: number, input?: ThreadCompactAsk): Effect.Effect<ThreadCompacted, HarnessFailure>;
  }
>()('tagma/native-harness/Compaction') {}

export class ThreadInstructions extends Context.Service<
  ThreadInstructions,
  {
    refresh(
      threadId: string,
      projectId: number,
    ): Effect.Effect<
      ThreadInstructionsRefreshed,
      HarnessFailure<(typeof CONTEXT_OPERATIONS)['refresh_thread_instructions']['refusals'][number] | FieldRefusal>
    >;
  }
>()('tagma/native-harness/ThreadInstructions') {}
