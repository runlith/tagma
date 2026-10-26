import { Cause, Effect, Exit } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { ThreadEvictionVerdict } from '../contract/wire/eviction.js';
import type { RolloutContext } from './rolloutContext.js';

export const rolloutShelf = (
  ctx: RolloutContext,
  evict: (
    projectId: number,
    threadId: string,
    still: Effect.Effect<boolean, HarnessFailure>,
  ) => Effect.Effect<ThreadEvictionVerdict, HarnessFailure>,
) => {
  const waiting = new Set<string>();
  let wake: (() => void) | null = null;

  const shelve = (threadIds: readonly string[]): void => {
    if (ctx.home === undefined) return;
    for (const threadId of threadIds) waiting.add(threadId);
    const woken = wake;
    wake = null;
    woken?.();
  };

  const next = Effect.callback<string>((resume) => {
    const take = () => {
      const [threadId] = waiting;
      waiting.delete(threadId!);
      resume(Effect.succeed(threadId!));
    };
    if (waiting.size > 0) take();
    else wake = take;
    return Effect.sync(() => {
      if (wake === take) wake = null;
    });
  });

  const archived = (threadId: string): Effect.Effect<boolean, HarnessFailure> =>
    ctx.records.facts(threadId).pipe(
      Effect.map((facts) => facts?.archivedAt != null),
      Effect.mapError((cause) => new ThreadStorageFailed({ call: 'shelf.archived', cause })),
    );

  const shelf = (threadId: string): Effect.Effect<void> =>
    Effect.flatMap(
      Effect.exit(
        Effect.gen(function* () {
          const facts = yield* ctx.records.facts(threadId);
          if (facts?.archivedAt == null || facts.projectId == null) return;
          yield* evict(facts.projectId, threadId, archived(threadId));
        }),
      ),
      (exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.logWarning(`the archived thread ${threadId} stays in the database until its next pass`, {
              reason: Cause.squash(exit.cause),
            }),
    ).pipe(Effect.withSpan('ThreadRollout.shelf', { attributes: { threadId } }));

  const shelving: Effect.Effect<never> = Effect.forever(Effect.flatMap(next, shelf));

  return { shelve, shelving };
};
