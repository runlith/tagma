import { Clock, Context, Effect, Layer } from 'effect';
import type { RunEnded } from '../thread/ending';
import type { KeyedRequest } from '../thread/keyed';
import type { ThreadReadFailure, ThreadRecord } from '../thread/record';
import type { ThreadChildSummary, ThreadPlaneFailure, ThreadSpawnResult } from './ThreadPlaneAccess';
import { makeBirths, type Provision, type ThreadSpawnRequest } from './births';
import type { SpawnLimit } from './spawnLimits';
import { Threads } from './threads';
import { childrenOf } from './treeActs';

export class ThreadSpawnTree extends Context.Service<
  ThreadSpawnTree,
  {
    spawn(input: ThreadSpawnRequest): Effect.Effect<ThreadSpawnResult, ThreadPlaneFailure>;
    answer(parent: ThreadRecord, child: ThreadRecord, provision: Provision): Effect.Effect<ThreadSpawnResult, ThreadPlaneFailure>;
    limits(parent: ThreadRecord, delegated: boolean, root: boolean): Effect.Effect<readonly SpawnLimit[], ThreadPlaneFailure>;
    listChildren(principal: string, parentThreadId: string): Effect.Effect<readonly ThreadChildSummary[], ThreadPlaneFailure>;
    settled(ended: RunEnded): Effect.Effect<void, ThreadReadFailure>;
  }
>()('@runlith/agent/ThreadSpawnTree') {}

const ACT_MS = 60_000;

export const threadSpawnTreeLayer = Layer.effect(
  ThreadSpawnTree,
  Effect.gen(function* () {
    const threads = yield* Threads;
    const request = (key: string): Effect.Effect<KeyedRequest> =>
      Effect.map(Clock.currentTimeMillis, (now) => ({ key, deadline: new Date(now + ACT_MS) }));
    const births = yield* makeBirths({ request });
    return ThreadSpawnTree.of({
      ...births,
      listChildren: (principal, parentThreadId) => childrenOf(threads, principal, parentThreadId),
    });
  }),
);
