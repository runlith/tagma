import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { FileRoot } from '../../../workspace/contract/wire/roots.js';

export class ThreadPlacement extends Context.Service<
  ThreadPlacement,
  {
    rootOf(threadId: string): Effect.Effect<RootId | null, GateRefusal>;
    rootsOf(threadId: string): Effect.Effect<readonly FileRoot[], GateRefusal>;
  }
>()('tagma/threads/ThreadPlacement') {}
