import { Context, type Effect } from 'effect';

export class ThreadRuns extends Context.Service<ThreadRuns, { running(threadId: string): Effect.Effect<boolean> }>()(
  'tagma/browser/ThreadRuns',
) {}
