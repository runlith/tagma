import { Context, Effect, Queue, Result, Stream } from 'effect';
import { GraphFeed } from '../contract/service/journal.js';
import { refusing } from '../../platform/contract/service/body.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import type { HolderCopies } from '../contract/service/holders.js';
import type { ServedGraphs } from '../contract/service/serving.js';
import type { graphFrameSchema, threadWorkFrameSchema } from '../contract/wire/feed.js';

import type { GraphRecoveries } from '../contract/service/recovery.js';
import type { GraphRemotes } from '../contract/service/remote.js';

export const graphChannel = (
  pool: ServedGraphs['Service'],
  recoveries: GraphRecoveries['Service'],
  holders: HolderCopies['Service'],
  remotes: GraphRemotes['Service'],
) => ({
  'graph.recovery': ({ projectId }: { readonly projectId: number }) => recoveries.follow(projectId),
  'graph.remote': ({ projectId }: { readonly projectId: number }) => remotes.follow(projectId),
  'graph.subscribe': ({ projectId, branch }: { readonly projectId: number; readonly branch?: string }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const served = yield* refusing(pool.hold({ projectId, branch }));
        const feed = Context.get(served.context, GraphFeed);
        const changes = yield* Queue.make<typeof graphFrameSchema.Type>();
        const detach = yield* feed
          .subscribe(projectId, (change) => Queue.offerUnsafe(changes, change))
          .pipe(Effect.provide(served.context));
        yield* Effect.addFinalizer(() => Effect.sync(detach));
        return Stream.concat(Stream.make({ type: 'resync' as const }), Stream.fromQueue(changes));
      }),
    ),
  'graph.work': ({ projectId, threadId }: { readonly projectId: number; readonly threadId: string }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const aims = yield* holders.of(threadId, projectId);
        if (aims === null) {
          return yield* new GateRefusal('not-found', `${threadId} is no thread of project ${projectId}`, [
            'follow the work of a thread in the project that holds it',
          ]);
        }
        const changes = yield* Queue.make<typeof threadWorkFrameSchema.Type>();
        const opened = yield* Effect.forEach(aims, (aim) => Effect.result(pool.hold(aim)), { concurrency: 'unbounded' });
        const seen = new Set<string>();
        for (const [at, open] of opened.entries()) {
          if (Result.isFailure(open)) {
            yield* Effect.logWarning('a graph copy the thread worked in is not followed: its read names it unread', {
              threadId,
              aim: aims[at],
              refusal: open.failure.message,
            });
            continue;
          }
          const served = open.success;
          const key = `${served.projectId}\u0000${served.checkout}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const detach = yield* Context.get(served.context, GraphFeed)
            .subscribe(served.projectId, (change) => {
              if (change.type !== 'change') return;
              Queue.offerUnsafe(changes, {
                type: 'change',
                own: change.sessions.some((session) => session.harness === NATIVE_HARNESS && session.key === threadId),
                names: change.events.flatMap((event) => (event.blockName === null ? [] : [event.blockName])),
              });
            })
            .pipe(Effect.provide(served.context));
          yield* Effect.addFinalizer(() => Effect.sync(detach));
        }
        return Stream.concat(Stream.make({ type: 'resync' as const }), Stream.fromQueue(changes));
      }),
    ),
});
