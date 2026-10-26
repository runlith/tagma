import { Deferred, Effect } from 'effect';

export class RunStop {
  private said: { readonly reason: unknown } | null = null;
  private readonly latch = Deferred.makeUnsafe<void>();
  private readonly listeners = new Set<() => void>();
  readonly reached: Effect.Effect<void> = Deferred.await(this.latch);

  get stopped(): boolean {
    return this.said !== null;
  }

  get reason(): unknown {
    return this.said?.reason ?? new DOMException('The run was stopped.', 'AbortError');
  }

  get message(): string {
    const reason = this.reason;
    return reason instanceof Error ? reason.message : String(reason);
  }

  stop(reason: unknown): boolean {
    if (this.said !== null) return false;
    this.said = { reason };
    Deferred.doneUnsafe(this.latch, Effect.void);
    const told = [...this.listeners];
    this.listeners.clear();
    for (const listener of told) listener();
    return true;
  }

  listen(listener: () => void): () => void {
    if (this.said !== null) {
      listener();
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  cut<A, E, R, B>(work: Effect.Effect<A, E, R>, stopped: B): Effect.Effect<A | B, E, R> {
    return Effect.suspend(() => (this.said === null ? Effect.raceFirst(work, Effect.as(this.reached, stopped)) : Effect.succeed(stopped)));
  }
}
