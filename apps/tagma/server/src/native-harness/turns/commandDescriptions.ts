import type { CommandDescription } from '@runlith/agent-tools/workspace';
import type { ThreadContextUse } from '@runlith/agent/thread/agents/ThreadAgent';
import { Effect } from 'effect';

export type CommandDescriptions = ReturnType<typeof commandDescriptions>;

export const commandDescriptions = () => {
  const held = new Map<string, CommandDescription>();
  return {
    of: <E>(use: ThreadContextUse, decide: Effect.Effect<CommandDescription, E>): Effect.Effect<CommandDescription, E> => {
      if (use.runId === null) return decide;
      const runId = use.runId;
      const standing = held.get(runId);
      if (standing !== undefined) return Effect.succeed(standing);
      return Effect.tap(decide, (value) =>
        Effect.sync(() => {
          held.set(runId, value);
        }),
      );
    },
    release: (runId: string) =>
      Effect.sync(() => {
        held.delete(runId);
      }),
  };
};
