import { Context, type Effect } from 'effect';
import type { FileReach } from '../../../platform/contract/wire/caller.js';

export class ScratchAreas extends Context.Service<
  ScratchAreas,
  {
    readonly root: string;
    directory(threadId: string): string;
    scope(threadId: string): FileReach;
    ensure(threadId: string): Effect.Effect<string>;
    release(threadId: string): Effect.Effect<void>;
  }
>()('tagma/threads/ScratchAreas') {}
