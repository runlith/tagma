import { Context, type Effect } from 'effect';
import type { HarnessFailure } from './failure.js';

export type ReleaseThread = (threadId: string) => Effect.Effect<'stopped' | 'not-running', HarnessFailure>;

export class ThreadReleasing extends Context.Service<
  ThreadReleasing,
  {
    release: ReleaseThread;
    serve(release: ReleaseThread): () => void;
  }
>()('tagma/threads/ThreadReleasing') {}
