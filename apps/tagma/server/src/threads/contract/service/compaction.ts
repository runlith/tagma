import { Context, type Effect } from 'effect';
import type { HarnessFailure } from './failure.js';

export class CompactionPlanning extends Context.Service<
  CompactionPlanning,
  {
    readonly instructions: string;
    threshold(threadId: string, provider: string, model: string | null, window: number): Effect.Effect<number, HarnessFailure>;
  }
>()('tagma/threads/CompactionPlanning') {}
