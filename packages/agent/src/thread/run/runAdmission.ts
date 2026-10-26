import { Context, Layer } from 'effect';

export class RunAdmission extends Context.Service<
  RunAdmission,
  {
    admits(threadId: string): boolean;
    hold(threadIds: readonly string[]): (wake?: boolean) => void;
    wakeOnLift(threadId: string): boolean;
    onLift(listener: (threadId: string) => void): () => void;
  }
>()('@runlith/agent/RunAdmission') {}

export const makeLandingHolds = () => {
  const held = new Map<string, number>();
  const owed = new Set<string>();
  const lifts = new Set<(threadId: string) => void>();
  return RunAdmission.of({
    admits: (threadId) => !held.has(threadId),

    wakeOnLift: (threadId) => {
      if (!held.has(threadId)) return false;
      owed.add(threadId);
      return true;
    },

    onLift: (listener) => {
      lifts.add(listener);
      return () => {
        lifts.delete(listener);
      };
    },

    hold: (threadIds) => {
      const mine = [...new Set(threadIds)];
      for (const threadId of mine) held.set(threadId, (held.get(threadId) ?? 0) + 1);
      let released = false;
      return (wake = true) => {
        if (released) return;
        released = true;
        for (const threadId of mine) {
          const standing = (held.get(threadId) ?? 1) - 1;
          if (standing > 0) {
            held.set(threadId, standing);
            continue;
          }
          held.delete(threadId);
          if (owed.delete(threadId) && wake) for (const lift of lifts) lift(threadId);
        }
      };
    },
  });
};

export const runAdmissionLayer = Layer.sync(RunAdmission, makeLandingHolds);
