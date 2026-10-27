import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export class ScratchFolders extends Context.Service<
  ScratchFolders,
  {
    of(threadId: string): Effect.Effect<string, GateRefusal<'files'>>;
  }
>()('tagma/checkout-files/ScratchFolders') {}
