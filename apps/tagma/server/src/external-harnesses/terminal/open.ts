import { Effect } from 'effect';
import type { ThreadRunStoppedBy } from '@runlith/agent/thread/ending';

export class OpenRuns {
  private readonly threads = new Map<string, string>();
  private readonly halts = new Map<string, ThreadRunStoppedBy | null>();
  private readonly launches = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();

  add(runId: string, threadId: string): void {
    this.threads.set(runId, threadId);
  }

  drop(runId: string): void {
    this.threads.delete(runId);
    this.halts.delete(runId);
  }

  end(runId: string): void {
    this.threads.delete(runId);
    if (!this.launches.has(runId)) this.halts.delete(runId);
  }

  has(runId: string): boolean {
    return this.threads.has(runId);
  }

  holds(runIds: readonly string[]): readonly string[] {
    return runIds.filter((runId) => this.threads.has(runId));
  }

  threadOf(runId: string): string | undefined {
    return this.threads.get(runId);
  }

  launching<A, E, R>(runId: string, launch: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => void this.launches.add(runId)),
      () => launch,
      () =>
        Effect.sync(() => {
          this.launches.delete(runId);
          if (this.halts.has(runId) && !this.threads.has(runId)) this.halts.delete(runId);
          this.wake(runId);
        }),
    );
  }

  inLaunch(runId: string): boolean {
    return this.launches.has(runId);
  }

  landing(runId: string): Effect.Effect<void> {
    return this.until(runId, () => !this.launches.has(runId));
  }

  halt(runId: string, by: ThreadRunStoppedBy | null): void {
    if (!this.threads.has(runId)) return;
    this.halts.set(runId, by);
    this.wake(runId);
  }

  halted(runId: string): boolean {
    return this.halts.has(runId);
  }

  stoppedBy(runId: string): ThreadRunStoppedBy | null {
    return this.halts.get(runId) ?? null;
  }

  halting(runId: string): Effect.Effect<void> {
    return this.until(runId, () => this.halts.has(runId));
  }

  private until(runId: string, reached: () => boolean): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      if (reached()) return resume(Effect.void);
      const waiting = this.waiters.get(runId) ?? new Set<() => void>();
      const wake = () => {
        if (!reached()) return;
        waiting.delete(wake);
        resume(Effect.void);
      };
      waiting.add(wake);
      this.waiters.set(runId, waiting);
      return Effect.sync(() => {
        waiting.delete(wake);
        if (waiting.size === 0 && this.waiters.get(runId) === waiting) this.waiters.delete(runId);
      });
    });
  }

  private wake(runId: string): void {
    const waiting = this.waiters.get(runId);
    if (waiting === undefined) return;
    for (const wake of [...waiting]) wake();
    if (waiting.size === 0) this.waiters.delete(runId);
  }
}
