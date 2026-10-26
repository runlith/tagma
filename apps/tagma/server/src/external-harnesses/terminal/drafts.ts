import { Effect } from 'effect';

export class ComposerDrafts {
  private readonly holds = new Map<string, number>();

  constructor(private readonly published: (threadId: string) => Effect.Effect<void, unknown>) {}

  held(threadId: string): boolean {
    return this.holds.has(threadId);
  }

  hold(threadId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const count = (this.holds.get(threadId) ?? 0) + 1;
      this.holds.set(threadId, count);
      return count === 1 ? this.shown(threadId) : Effect.void;
    });
  }

  release(threadId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const count = (this.holds.get(threadId) ?? 0) - 1;
      if (count > 0) {
        this.holds.set(threadId, count);
        return Effect.void;
      }
      this.holds.delete(threadId);
      return this.shown(threadId);
    });
  }

  private shown(threadId: string): Effect.Effect<void> {
    return this.published(threadId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning('the thread snapshot was not republished after a draft in the CLI composer began or stopped holding words', {
          threadId,
          cause,
        }),
      ),
    );
  }
}
