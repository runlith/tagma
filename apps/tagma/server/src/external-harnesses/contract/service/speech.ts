import { Context, type Effect } from 'effect';
import type { ThreadSaid } from '@runlith/agent/thread/run/scheduler/inputs';
import type { HarnessFailure } from '../../../threads/contract/service/failure.js';

export class HarnessSpeech extends Context.Service<
  HarnessSpeech,
  {
    speak(threadId: string, projectId: number, text: string): Effect.Effect<ThreadSaid, HarnessFailure>;
  }
>()('tagma/external-harnesses/HarnessSpeech') {}

export class ScreenAsks extends Context.Service<
  ScreenAsks,
  {
    text(threadId: string, projectId: number): Effect.Effect<{ text: string }, HarnessFailure>;
  }
>()('tagma/external-harnesses/ScreenAsks') {}
