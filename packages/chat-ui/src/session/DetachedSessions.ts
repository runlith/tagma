import type { ChatFold } from '../ChatFold.svelte';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import type { ChatState, ChatThreadView } from '../wire/ChatConnection';

export type DetachedSession<TThread extends ChatThreadView> = {
  readonly fold: ChatFold;
  readonly at: FeedPosition;
  readonly state: ChatState<TThread>;
  readonly readAt: number;
};

export type DetachedBudget = {
  readonly sessions?: number;
  readonly bytes?: number;
};

const SESSIONS = 8;
const BYTES = 32 * 1024 * 1024;

export class DetachedSessions<TThread extends ChatThreadView> {
  private readonly held = new Map<string, { readonly session: DetachedSession<TThread>; readonly weight: number }>();
  private readonly sessions: number;
  private readonly bytes: number;
  private weight = 0;

  constructor(budget: DetachedBudget = {}) {
    this.sessions = budget.sessions ?? SESSIONS;
    this.bytes = budget.bytes ?? BYTES;
  }

  put(threadId: string, session: DetachedSession<TThread>): void {
    this.drop(threadId);
    const weight = session.fold.weight;
    if (weight > this.bytes / 4) return;
    this.held.set(threadId, { session, weight });
    this.weight += weight;
    for (const oldest of this.held.keys()) {
      if (this.held.size <= this.sessions && this.weight <= this.bytes) break;
      this.drop(oldest);
    }
  }

  take(threadId: string): DetachedSession<TThread> | undefined {
    const held = this.held.get(threadId);
    this.drop(threadId);
    return held?.session;
  }

  private drop(threadId: string): void {
    const held = this.held.get(threadId);
    if (held === undefined) return;
    this.held.delete(threadId);
    this.weight -= held.weight;
  }
}
