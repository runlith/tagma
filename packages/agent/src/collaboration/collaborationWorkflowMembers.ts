import { Clock, Effect, Layer } from 'effect';
import { ThreadCallBroke, ThreadMissing, isThreadBorderFailure, type ThreadBorderFailed } from '../thread/ThreadBorder';
import { ThreadWorkflowMembers } from '../thread/ThreadPorts';
import { ThreadEnvelopes } from './ThreadEnvelopes';
import { ThreadSpawnTree } from './ThreadSpawnTree';
import { Threads } from './threads';

const bordered = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, ThreadBorderFailed> =>
  Effect.mapError(work, (failure) => (isThreadBorderFailure(failure) ? failure : new ThreadCallBroke({ cause: failure })));

export const collaborationWorkflowMembersLayer: Layer.Layer<ThreadWorkflowMembers, never, ThreadEnvelopes | ThreadSpawnTree | Threads> =
  Layer.effect(
    ThreadWorkflowMembers,
    Effect.gen(function* () {
      const envelopes = yield* ThreadEnvelopes;
      const spawnTree = yield* ThreadSpawnTree;
      const threads = yield* Threads;

      return {
        startMember: (input) =>
          bordered(
            Effect.gen(function* () {
              const parent = yield* threads.find(input.parent.id, input.parent.ownerId);
              if (parent === null) return yield* new ThreadMissing({ threadId: input.parent.id });
              return yield* spawnTree.spawn({ ...input, parent, reportDelivery: 'collect' });
            }),
          ),
        waitForReports: (input) =>
          bordered(
            Effect.gen(function* () {
              const since = new Date(yield* Clock.currentTimeMillis);
              const reports = yield* envelopes
                .access({ id: input.thread.id, principal: input.thread.ownerId })
                .collect({ from: input.members, deadlineMs: input.deadlineMs, since });
              return new Map([...reports].map(([member, arrival]) => [member, arrival.text] as const));
            }),
          ),
      };
    }),
  );
