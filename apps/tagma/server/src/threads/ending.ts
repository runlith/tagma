import { randomUUID } from 'node:crypto';
import { Context, Duration, Effect, Exit } from 'effect';
import { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { ThreadDeleteStillSettlingError } from '@runlith/agent/thread/storage/aggregate';
import { ThreadCallBroke, threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { EngineHandles } from '@runlith/agent/thread/AgentHarness';
import type { ThreadStop, ThreadStopOptions } from '@runlith/agent/thread/ending';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { ThreadLookup, ThreadRunning } from './contract/service/reads.js';
import { HarnessCalls, McpForgetting, ThreadTeardown } from './contract/service/engine.js';
import { HarnessAsides } from './contract/service/asides.js';
import { ThreadRecords } from '../thread-record/contract/service/records.js';
import { type Actor, OPERATOR_PRINCIPAL } from '../platform/contract/wire/actor.js';
import { type ArchiveClose, ThreadList } from './contract/service/list.js';
import type { ThreadListProjection } from './list/summary.js';
import { gated } from './projectGate.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { HarnessFailure } from './contract/service/failure.js';
import { ThreadReleasing } from './contract/service/releasing.js';
import { HeldTasks } from './contract/service/heldTasks.js';
import { ThreadRollouts } from './contract/service/rollouts.js';
import { lineageOf, refuseOwnLineage } from './ownLineage.js';

export type EndingPatience = { readonly settle: Duration.Duration };

const ENDING_PATIENCE: EndingPatience = { settle: Duration.seconds(30) };

export class ThreadEnding extends Context.Service<
  ThreadEnding,
  {
    stop(
      threadId: string,
      projectId: number,
      expectedRunId: string | undefined,
      options: ThreadStopOptions,
    ): Effect.Effect<ThreadStop, HarnessFailure>;
    archiving<A, E>(threadIds: readonly string[], work: (close: ArchiveClose) => Effect.Effect<A, E>): Effect.Effect<A, E | HarnessFailure>;
    archive(threadId: string, projectId: number, by: Actor): Effect.Effect<ThreadListProjection, HarnessFailure>;
    delete(threadId: string, projectId: number, by?: Actor): Effect.Effect<boolean, HarnessFailure>;
    closeProject(projectId: number): Effect.Effect<void>;
  }
>()('tagma/threads/ThreadEnding') {}

export type EndingWalk = ThreadEnding['Service'];

export const makeThreadEnding = Effect.fnUntraced(function* ({
  harness,
  patience: given,
}: {
  readonly harness: EngineHandles;
  readonly patience?: Partial<EndingPatience>;
}) {
  const { subtree } = yield* ThreadLookup;
  const { heldSessionsInSubtree, heldSessionsIn } = yield* ThreadRunning;
  const records = yield* ThreadRecords;
  const list = yield* ThreadList;
  const mcpBound = yield* McpForgetting;
  const asides = yield* HarnessAsides;
  const releasing = yield* ThreadReleasing;
  const { endHeld, endCommands, afterDeleted } = yield* ThreadTeardown;
  const calls = yield* HarnessCalls;
  const admission = yield* RunAdmission;
  const rollouts = yield* ThreadRollouts;
  const held = yield* HeldTasks;
  const patience = { ...ENDING_PATIENCE, ...given };

  const closeWork = Effect.fn('ThreadEnding.closeWork')(function* (threadIds: readonly string[]) {
    const act = randomUUID();
    const projects = yield* records.projectsOf(threadIds);
    for (const [projectId, ids] of Map.groupBy(threadIds, (id) => projects.get(id))) {
      if (projectId == null) continue;
      yield* endCommands({
        projectId,
        threadIds: ids,
        cause: 'scope-closed',
        operation: HostRequestKey.make(`thread-archive:${act}:${projectId}`),
      });
    }
    yield* calls.end(threadIds, 'scope-closed');
  });

  const leftOver =
    (projectId: number, what: string) =>
    <A, E>(work: Effect.Effect<A, E>): Effect.Effect<void> =>
      Effect.flatMap(Effect.exit(work), (exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.logWarning(`the removal of project ${projectId} left ${what} standing`, { cause: exit.cause }),
      );

  const closeProject = Effect.fn('ThreadEnding.closeProject')(function* (projectId: number) {
    const read = yield* Effect.exit(heldSessionsIn(projectId));
    if (Exit.isFailure(read)) {
      return yield* Effect.logWarning(`the work of removed project ${projectId} could not be read, so none of it was stopped`, {
        cause: read.cause,
      });
    }
    const held = read.value;
    if (held.length === 0) return;
    const ids = [...new Set(held.map((session) => session.threadId))];
    yield* Effect.acquireUseRelease(
      Effect.sync(() => admission.hold(ids)),
      () =>
        Effect.gen(function* () {
          for (const session of held) {
            if (session.kind !== 'run') continue;
            yield* harness
              .handle(session.threadId, OPERATOR_PRINCIPAL)
              .stop(session.runId, { door: 'project-removed' })
              .pipe(leftOver(projectId, `run ${session.runId} of thread ${session.threadId}`));
          }
          yield* closeWork(ids).pipe(leftOver(projectId, 'commands or calls of its threads'));
          for (const id of ids) yield* releasing.release(id).pipe(leftOver(projectId, `the transport of thread ${id}`));
        }),
      (lift) => Effect.sync(() => lift(false)),
    );
  });

  const ending = ThreadEnding.of({
    stop: (threadId, projectId, expectedRunId, options) =>
      gated(records, threadId, projectId, () => harness.handle(threadId, OPERATOR_PRINCIPAL).stop(expectedRunId, options)),
    archiving: (threadIds, work) => {
      const closed: ((wake?: boolean) => void)[] = [];
      return Effect.acquireUseRelease(
        Effect.sync(() => admission.hold(threadIds)),
        () =>
          work((ids) =>
            Effect.andThen(
              Effect.sync(() => {
                closed.push(admission.hold(ids));
              }),
              Effect.andThen(closeWork(ids), held.left(ids)),
            ),
          ),
        (lift, exit) =>
          Effect.sync(() => {
            lift(true);
            for (const end of closed) end(!Exit.isSuccess(exit));
          }),
      );
    },
    archive: (threadId, projectId, by) => {
      const asking = lineageOf(by);
      return gated(records, threadId, projectId, () =>
        Effect.acquireUseRelease(
          Effect.map(subtree(threadId), (tree) => {
            const lift = admission.hold(tree.map((member) => member.id));
            return (kept: boolean) => lift(!kept);
          }),
          () =>
            Effect.gen(function* () {
              for (const session of yield* heldSessionsInSubtree(threadId)) {
                if (session.kind !== 'run') continue;
                if (asking !== null && (yield* records.relation(session.threadId, asking)) === 'lineage') continue;
                yield* harness.handle(session.threadId, OPERATOR_PRINCIPAL).stop(session.runId, { door: 'archive' });
              }
            }).pipe(Effect.andThen(list.setArchived(threadId, projectId, true, asking))),
          (lift, exit) => Effect.sync(() => lift(Exit.isSuccess(exit))),
        ),
      );
    },
    delete: (threadId, projectId, by = { kind: 'operator' }) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const act = randomUUID();
          yield* refuseOwnLineage(records, threadId, by);
          const tree = yield* subtree(threadId);
          for (const session of yield* heldSessionsInSubtree(threadId)) {
            if (session.kind === 'run') yield* harness.handle(session.threadId, OPERATOR_PRINCIPAL).stop(session.runId, { door: 'delete' });
          }
          for (const [swept, members] of Map.groupBy(tree, (member) => member.projectId)) {
            if (swept === null) continue;
            yield* endCommands({
              projectId: swept,
              threadIds: members.map((member) => member.id),
              cause: 'scope-closed',
              operation: HostRequestKey.make(`thread-delete:${threadId}:${act}`),
            });
          }
          yield* calls.end(
            tree.map((member) => member.id),
            'scope-closed',
          );
          for (const member of tree) yield* releasing.release(member.id);
          yield* held.left(tree.map((member) => member.id));
          yield* endHeld(tree, act);
          const taken = tree.map((member) => member.id);
          const freeing = yield* rollouts.freeing(taken);
          const deleted = yield* harness.handle(threadId, OPERATOR_PRINCIPAL).delete(patience.settle);
          if (!deleted) return false;
          yield* freeing;
          for (const id of taken) {
            mcpBound.forget(id);
            yield* asides.forget(id);
          }
          yield* afterDeleted(
            taken,
            tree.flatMap((member) => (member.host === null ? [] : [member.host])),
          );
          return true;
        }).pipe(
          Effect.catch((failure) => {
            const cause = threadCauseOf(failure);
            return cause instanceof ThreadDeleteStillSettlingError
              ? Effect.fail(
                  new GateRefusal(
                    'still-settling',
                    cause.message,
                    cause.runId === null
                      ? [`delete thread ${threadId} again after its activity record finishes writing`]
                      : [
                          `read run ${cause.runId} and delete thread ${threadId} again after it settles`,
                          `stop thread ${cause.threadId}, then delete thread ${threadId} again`,
                        ],
                  ),
                )
              : Effect.fail(failure);
          }),
        ),
      ),
    closeProject,
  });
  return ending;
});

export const makeRunSweep = Effect.fnUntraced(function* () {
  const records = yield* ThreadRecords;
  const { endCommands } = yield* ThreadTeardown;
  const calls = yield* HarnessCalls;
  const sweepRun = Effect.fn('ThreadEnding.sweepRun')(function* (threadId: string, projectId: number, run: string) {
    yield* endCommands({
      projectId,
      threadIds: [threadId],
      run,
      cause: 'run-abort',
      operation: HostRequestKey.make(`thread-stop:${threadId}:${run}`),
    });
    yield* calls.end([threadId], 'run-abort', run);
  });
  return {
    sweep: (threadId: string, run: string) =>
      Effect.flatMap(
        Effect.mapError(records.projectOf(threadId), (cause) => new ThreadStorageFailed({ call: 'sweepRun.project', cause })),
        (projectId) =>
          projectId === undefined
            ? Effect.void
            : Effect.mapError(sweepRun(threadId, projectId, run), (cause) => new ThreadCallBroke({ cause })),
      ),
  };
});
