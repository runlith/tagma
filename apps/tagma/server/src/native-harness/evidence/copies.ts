import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { type Context, Effect } from 'effect';
import type { GraphServices } from '../../graph/contract/service/services.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { TargetSnapshots } from '../../threads/contract/service/targetSnapshots.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { UnreadGraph } from '../../threads/contract/wire/evidence.js';
import { ThreadGraphs } from '../contract/service/graphs.js';

type ThreadCopyReading = {
  readonly served: readonly Context.Context<GraphServices | GraphStore>[];
  readonly unread: readonly UnreadGraph[];
};

export type ThreadCopies = (
  threadId: string,
  projectId: number,
  runIds: readonly string[] | null,
) => Effect.Effect<ThreadCopyReading, HarnessFailure>;

export const threadCopies = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const snapshots = yield* TargetSnapshots;
  const graphs = yield* ThreadGraphs;
  const projects = yield* Projects;
  const copies: ThreadCopies = Effect.fnUntraced(function* (threadId, projectId, runIds) {
    const recorded = yield* units
      .read((unit) => snapshots.origins(threadId, runIds, unit))
      .pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    const origins = recorded.length > 0 ? recorded : [{ projectId, root: (yield* projects.byId(projectId)).rootPath }];
    const opened = yield* Effect.forEach(origins, (origin) =>
      Effect.map(Effect.result(graphs.graphAt(origin)), (result) => ({ origin, result })),
    );
    const served = new Map<string, Context.Context<GraphServices | GraphStore>>();
    const unread: UnreadGraph[] = [];
    for (const { origin, result } of opened) {
      if (result._tag === 'Success') served.set(result.success.checkout, result.success.context);
      else unread.push({ projectId: origin.projectId, root: origin.root, code: result.failure.code, reason: result.failure.reason });
    }
    return { served: [...served.values()], unread };
  });
  return copies;
});
