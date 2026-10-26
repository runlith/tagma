import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { type Context, Effect } from 'effect';
import type { GraphServices } from '../../graph/contract/service/services.js';
import type { GraphStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { TargetSnapshots } from '../../threads/contract/service/targetSnapshots.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { ThreadGraphs } from '../contract/service/graphs.js';

export type ThreadCopies = (
  threadId: string,
  projectId: number,
  runIds: readonly string[] | null,
) => Effect.Effect<readonly Context.Context<GraphServices | GraphStore>[], HarnessFailure>;

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
    const opened = yield* Effect.forEach(origins, (origin) => graphs.graphAt(origin));
    return [...new Map(opened.map((served) => [served.checkout, served.context] as const)).values()];
  });
  return copies;
});
