import { Deferred, Effect } from 'effect';
import type { AskDelivery } from '@runlith/agent/thread/transport/contract';

export class AskLandings {
  private readonly waiting = new Map<string, Deferred.Deferred<AskDelivery>>();

  expect(threadId: string, ask: string | number): Deferred.Deferred<AskDelivery> {
    const landing = Deferred.makeUnsafe<AskDelivery>();
    this.waiting.set(this.key(threadId, ask), landing);
    return landing;
  }

  forget(threadId: string, ask: string | number): void {
    this.waiting.delete(this.key(threadId, ask));
  }

  settle(threadId: string, ask: string | number, delivery: AskDelivery): Effect.Effect<void> {
    const key = this.key(threadId, ask);
    const landing = this.waiting.get(key);
    if (landing === undefined) return Effect.void;
    this.waiting.delete(key);
    return Effect.asVoid(Deferred.succeed(landing, delivery));
  }

  private key(threadId: string, ask: string | number): string {
    return `${threadId}\u0000${String(ask)}`;
  }
}
