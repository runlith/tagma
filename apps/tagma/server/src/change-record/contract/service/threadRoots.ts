import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';

export class ThreadRoots extends Context.Service<
  ThreadRoots,
  {
    readonly rootOf: (threadId: string) => Effect.Effect<RootId | null, GateRefusal>;
  }
>()('tagma/change-record/ThreadRoots') {}
