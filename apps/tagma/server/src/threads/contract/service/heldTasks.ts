import { Context, type Effect } from 'effect';
import type { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export class HeldTasks extends Context.Service<
  HeldTasks,
  {
    left(threadIds: readonly string[]): Effect.Effect<void, GateRefusal<'thread-tasks-unreadable'> | ThreadCallBroke>;
  }
>()('tagma/threads/HeldTasks') {}
