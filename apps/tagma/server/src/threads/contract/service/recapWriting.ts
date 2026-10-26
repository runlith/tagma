import { Context, type Effect } from 'effect';
import type { HarnessFailure } from './failure.js';
import type { RecapReading } from '../wire/recap.js';

export class ThreadRecapWriting extends Context.Service<
  ThreadRecapWriting,
  {
    generate(threadId: string, projectId: number): Effect.Effect<RecapReading, HarnessFailure>;
  }
>()('tagma/threads/ThreadRecapWriting') {}
