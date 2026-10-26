import { Context, type Effect } from 'effect';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ModelChange } from './modelChanges.js';
import type { ThreadDecisions } from './decisions.js';

export type ThreadFact =
  | { readonly kind: 'model-changed'; readonly change: ModelChange }
  | { readonly kind: 'committed'; readonly commit: string; readonly subject: string }
  | { readonly kind: 'task-closed'; readonly id: string; readonly block: string; readonly title: string; readonly word: string };

export class ThreadEvents extends Context.Service<
  ThreadEvents,
  {
    told(threadId: string, fact: ThreadFact): Effect.Effect<void, ThreadBorderFailed>;
    serveDecisions(decisions: ThreadDecisions['Service']): () => void;
  }
>()('tagma/threads/ThreadEvents') {}
