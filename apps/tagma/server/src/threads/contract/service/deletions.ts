import { Context, type Effect } from 'effect';
import type { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { Actor } from '../../../platform/contract/wire/actor.js';

export class ThreadDeletions extends Context.Service<
  ThreadDeletions,
  {
    deleting(
      tree: readonly string[],
      running: ReadonlySet<string>,
      by: Actor,
    ): Effect.Effect<Effect.Effect<void, ThreadCallBroke>, ThreadCallBroke>;
  }
>()('tagma/threads/ThreadDeletions') {}
