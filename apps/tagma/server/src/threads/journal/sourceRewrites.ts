import { Effect } from 'effect';

export type SourceRewrites = ReturnType<typeof sourceRewrites>;

export const sourceRewrites = () => {
  const followers = new Set<(threadId: string) => Effect.Effect<void>>();
  return {
    told: (threadId: string): Effect.Effect<void> =>
      Effect.suspend(() => Effect.forEach([...followers], (follower) => follower(threadId), { discard: true })),
    follow: (follower: (threadId: string) => Effect.Effect<void>): (() => void) => {
      followers.add(follower);
      return () => void followers.delete(follower);
    },
  };
};
