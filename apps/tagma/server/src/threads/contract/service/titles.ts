import type { AgentAsideHook } from '@runlith/agent/AgentAside';
import { Context, type Effect } from 'effect';
import type { ThreadTitleAnswer } from '../wire/titles.js';
import type { HarnessFailure } from './failure.js';

export class ThreadTitles extends Context.Service<
  ThreadTitles,
  {
    published(threadId: string): Effect.Effect<void, never>;
    opening(projectId: number, threadId: string): Effect.Effect<AgentAsideHook | null, never>;
    generate(threadId: string, projectId: number): Effect.Effect<ThreadTitleAnswer, HarnessFailure>;
    begun(threadId: string, runId: string): Effect.Effect<void, HarnessFailure>;
  }
>()('tagma/threads/ThreadTitles') {}
