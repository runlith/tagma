import { Context, Effect, Layer } from 'effect';
import type { ThreadReadFailure, ThreadRecord } from '../thread/record';
import { ThreadCallBroke, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { DeclaredCollaboration, SUB_AGENT_DEPTH } from './CollaborationConfig';
import { Threads } from './threads';

export type ThreadSpawnDepth = {
  readonly current: number;
  readonly maximum: number;
  readonly remaining: number;
};

export const spawnDepthAt = (current: number, maximum: number): ThreadSpawnDepth => ({
  current,
  maximum,
  remaining: Math.max(0, maximum - current),
});

export class ThreadSpawnAccess extends Context.Service<
  ThreadSpawnAccess,
  {
    depth(thread: ThreadRecord): Effect.Effect<ThreadSpawnDepth, ThreadBorderFailed | ThreadReadFailure>;
  }
>()('@runlith/agent/ThreadSpawnAccess') {}

export const threadSpawnAccessLayer = Layer.effect(
  ThreadSpawnAccess,
  Effect.gen(function* () {
    const collaboration = yield* DeclaredCollaboration;
    const threads = yield* Threads;
    return ThreadSpawnAccess.of({
      depth: Effect.fnUntraced(function* (thread) {
        if (!collaboration) {
          return yield* new ThreadCallBroke({
            cause: new Error('This host declared no collaboration, so it has no sub-agent depth.'),
          });
        }
        const maximum = yield* collaboration.subAgentDepth(thread);
        if (!Number.isInteger(maximum) || maximum < SUB_AGENT_DEPTH.minimum || maximum > SUB_AGENT_DEPTH.maximum) {
          return yield* new ThreadCallBroke({
            cause: new Error(
              `Sub-agent depth must be an integer from ${SUB_AGENT_DEPTH.minimum} through ${SUB_AGENT_DEPTH.maximum}; this host resolved ${maximum}.`,
            ),
          });
        }

        const lineage = yield* threads.lineage(thread.id, thread.principal);
        if (!lineage.complete) {
          const missing = (lineage.ancestors.at(-1) ?? thread).parentThreadId;
          return yield* new ThreadCallBroke({
            cause: new Error(`Thread ${thread.id} has a missing spawn ancestor ${missing}.`),
          });
        }
        return spawnDepthAt(lineage.ancestors.length, maximum);
      }),
    });
  }),
);
