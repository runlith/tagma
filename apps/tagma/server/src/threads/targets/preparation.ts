import { Clock, Data, Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadContextAsk } from '@runlith/agent/thread/run/ThreadRunContexts';
import type { ThreadContextUse } from '@runlith/agent/thread/agents/ThreadAgent';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { assignmentMembership, assignmentSelection, placementRows } from '../../workspace/store/tables.js';
import { makeThreadTargetOperationStore } from '../store/targetIntents.js';
import { threadTargetOperation } from '../store/tables.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import type { Assignment } from '../../workspace/contract/wire/assignments.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { rootOfSourceKey, targetSourceKey } from '../contract/wire/target.js';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import { type GraphOrigin, type TargetSnapshot } from '../contract/wire/target.js';
import type { ProvedRoot, TargetAt } from '../../workspace/contract/wire/place.js';
import { Assignments } from '../../workspace/contract/service/assignments.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { TargetSnapshots } from '../contract/service/targetSnapshots.js';
import { placementRefusal } from './placementRefusal.js';
import type { WorldUnavailable } from '../../executions/contract/service/worlds.js';
import type {
  AdmittedTarget,
  PreparedTarget,
  TargetChange,
  TargetFailure,
  TargetHomeMove,
  TargetStanding,
  TargetThread,
  WorldAcquire,
} from '../contract/service/preparation.js';
import { TargetPreparation } from '../contract/service/preparation.js';

class TargetPublicationRefused extends Data.TaggedError('TargetPublicationRefused')<{ readonly message: string }> {}

const preparedKey = (at: TargetAt): string => `${at.threadId}\u0000${at.runId}`;

export type TargetContexts = Effect.Success<typeof makeTargetContexts>;

export const makeTargetContexts = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const targets = yield* TargetSnapshots;
  const assignments = yield* Assignments;
  const roots = yield* FileRoots;
  const projects = yield* Projects;
  const operations = yield* makeThreadTargetOperationStore;
  const projectRoot = (projectId: number) => Effect.map(projects.byId(projectId), (project) => project.rootPath);
  const prepared = new Map<string, TargetSnapshot>();

  const of: (thread: TargetThread, use: ThreadContextUse, acquire: WorldAcquire) => Effect.Effect<AdmittedTarget, TargetFailure> =
    Effect.fn('TargetContexts.of')(function* (
      thread: TargetThread,
      use: ThreadContextUse,
      acquire: WorldAcquire,
    ): Effect.fn.Return<AdmittedTarget, TargetFailure> {
      const at: TargetAt = {
        threadId: thread.id,
        runId: use.runId ?? thread.id,
        generation: WorkspaceGeneration.make(use.context?.generation ?? 0),
      };
      const recorded = yield* units.read((unit) => targets.at(at, unit)).pipe(unreadable(at));
      if (recorded !== undefined) {
        settled(at, recorded.generation);
        const acquired = yield* acquire({ at, root: recorded.workingRoot, projectId: recorded.work.projectId });
        return { target: recorded, world: acquired.world };
      }
      if (use.context !== null) {
        const unpublished = prepared.get(preparedKey(at));
        if (unpublished !== undefined && unpublished.generation === at.generation && unpublished.sourceKey === use.context.sourceKey) {
          const acquired = yield* acquire({ at, root: unpublished.workingRoot, projectId: unpublished.work.projectId });
          return { target: unpublished, world: acquired.world };
        }
        return yield* new GateRefusal(
          'target-unrecorded',
          `Run ${at.runId} records generation ${at.generation}, and no destination was recorded for it.`,
          ["Read the run's context changes to see which generation it reached, and start a fresh run for this thread."],
        );
      }
      const opening = yield* openTarget(thread);
      const acquired = yield* acquire({ at, root: opening.root, projectId: thread.projectId });
      const target = yield* record(at, {
        sourceKey: opening.sourceKey,
        workingRoot: acquired.world.root,
        place: acquired.place,
        projectId: thread.projectId,
        graph: { projectId: thread.projectId, root: opening.root },
        persist: use.runId !== null,
      });
      if (target.workingRoot === acquired.world.root) return { target, world: acquired.world };
      return { target, world: (yield* acquire({ at, root: target.workingRoot, projectId: target.work.projectId })).world };
    });

  const prepare: (change: TargetChange, acquire: WorldAcquire) => Effect.Effect<PreparedTarget, TargetFailure> = Effect.fn(
    'TargetContexts.prepare',
  )(function* (change: TargetChange, acquire: WorldAcquire): Effect.fn.Return<PreparedTarget, TargetFailure> {
    const at: TargetAt = {
      threadId: change.thread.id,
      runId: change.runId,
      generation: WorkspaceGeneration.make(change.fromGeneration + 1),
    };
    const home = change.home;
    const assignment = yield* readAssignment(change.thread);
    const rootId = home?.root.rootId ?? assignment.selection.rootId;
    if (rootId === null || (home === undefined && assignment.standing !== 'live')) {
      return yield* noDestination(change.thread, assignment);
    }
    const root = yield* units.read((unit) => roots.checked(rootId, home?.root.locationRevision, unit)).pipe(unregistered);
    const acquired = yield* acquire({ at, root: root.path, projectId: change.thread.projectId });
    const target: TargetSnapshot = {
      work: { projectId: change.thread.projectId, threadId: change.thread.id },
      runId: at.runId,
      generation: at.generation,
      sourceKey: targetSourceKey(rootId),
      workingRoot: acquired.world.root,
      place: acquired.place,
      graph: { projectId: change.thread.projectId, root: root.path },
      admittedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    };
    const revision = assignment.selection.revision;

    prepared.set(preparedKey(at), target);
    return {
      target,
      world: acquired.world,
      ask: {
        requestId: change.requestId,
        sourceKey: target.sourceKey,
        commit: Effect.fnUntraced(
          function* (unit) {
            const threadId = change.thread.id as ThreadId;
            const decided = home === undefined ? revision : yield* homeSelected(unit, threadId, home);
            const publication = yield* assignments.publish(unit, threadId, decided);
            if (!publication.current) {
              return yield* Effect.fail(
                new TargetPublicationRefused({
                  message: `The placement this context was prepared from has been overtaken: selection revision ${revision} is no longer the one that stands.`,
                }),
              );
            }
            if (publication.standing !== 'live') {
              return yield* Effect.fail(
                new TargetPublicationRefused({
                  message: `The root this context was prepared for is no longer registered: ${publication.standing}.`,
                }),
              );
            }
            yield* targets.record(target, unit);
            if (home !== undefined) yield* home.shift(unit);
            yield* operations.settle(threadId, change.requestId, { status: 'applied', generation: at.generation }, unit);
            settled(at, at.generation);
          },
          Effect.mapError((cause) => new ThreadCallBroke({ cause })),
        ),
      },
    };
  });

  const homeSelected = Effect.fnUntraced(function* (unit: WriteUnit<'machine'>, threadId: ThreadId, home: TargetHomeMove) {
    const standing = yield* assignments.read(unit, threadId);
    if (standing.selection.revision !== home.revision) {
      return yield* Effect.fail(
        new TargetPublicationRefused({
          message: `The placement this move was decided against has been overtaken: selection revision ${home.revision} is no longer the one that stands.`,
        }),
      );
    }
    const selected = yield* assignments.select(unit, { actor: home.actor, threadId, root: home.root });
    return selected.selection.revision;
  });

  const openTarget = Effect.fn('TargetContexts.opening')(function* (
    thread: TargetThread,
  ): Effect.fn.Return<{ root: string; sourceKey: string }, StoreFailure | GateRefusal> {
    const assignment = yield* readAssignment(thread);
    const { selection } = assignment;
    if (selection.provenance === 'intrinsic') {
      return { root: thread.root ?? (yield* projectRoot(thread.projectId)), sourceKey: 'intrinsic' };
    }
    if (selection.rootId === null || assignment.standing !== 'live') {
      return yield* noDestination(thread, assignment);
    }
    const rootId = selection.rootId;
    const root = yield* units.read((unit) => roots.checked(rootId, undefined, unit)).pipe(unregistered);
    return { root: root.path, sourceKey: targetSourceKey(rootId) };
  });

  const noDestination = Effect.fn('TargetContexts.noDestination')(function* (
    thread: TargetThread,
    assignment: Assignment,
  ): Effect.fn.Return<never, GateRefusal> {
    return yield* new GateRefusal(
      'target-no-destination',
      assignment.standing === 'gone'
        ? `The root thread ${thread.id} is working is no longer registered.`
        : `Thread ${thread.id} has no selected root: its placement was cleared, and a cleared placement is not the intrinsic one.`,
      ['Select the registered root this thread should work in.'],
    );
  });

  const readAssignment = Effect.fn('TargetContexts.assignment')(function* (
    thread: TargetThread,
  ): Effect.fn.Return<Assignment, StoreFailure | GateRefusal> {
    return yield* units
      .read((unit) => assignments.read(unit, thread.id as ThreadId))
      .pipe(
        refusing('target-placement-unreadable', (detail) => `The placement of thread ${thread.id} cannot be read: ${detail}`, [
          "Read the thread's assignment, and select the registered root it should work in.",
        ]),
      );
  });

  const standing: (thread: TargetThread) => Effect.Effect<TargetStanding, StoreFailure | GateRefusal> = Effect.fn(
    'TargetContexts.standing',
  )(function* (thread: TargetThread): Effect.fn.Return<TargetStanding, StoreFailure | GateRefusal> {
    const { root, sourceKey } = yield* openTarget(thread);
    const placed = rootOfSourceKey(sourceKey);
    if (placed !== null) yield* roots.read(placed).pipe(unregistered);
    return { root, graph: { projectId: thread.projectId, root } };
  });

  const record = Effect.fn('TargetContexts.record')(function* (
    at: TargetAt,
    composed: {
      sourceKey: string;
      workingRoot: string;
      place: ProvedRoot | null;
      projectId: number;
      graph: GraphOrigin;
      persist: boolean;
    },
  ): Effect.fn.Return<TargetSnapshot, TargetFailure> {
    const target: TargetSnapshot = {
      work: { projectId: composed.projectId, threadId: at.threadId },
      runId: at.runId,
      generation: at.generation,
      sourceKey: composed.sourceKey,
      workingRoot: composed.workingRoot,
      place: composed.place,
      graph: composed.graph,
      admittedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    };
    if (!composed.persist) return target;
    return yield* units.write(targets.writes, (unit) => targets.record(target, unit)).pipe(unreadable(at));
  });

  const settled = (at: TargetAt, generation: WorkspaceGeneration): void => {
    const standing = prepared.get(preparedKey(at));
    if (standing !== undefined && standing.generation <= generation) prepared.delete(preparedKey(at));
  };
  return TargetPreparation.of({
    writes: writes('TargetContexts.commit', [assignmentMembership, placementRows, threadTargetOperation], targets.writes),
    of,
    prepare,
    standing,
  });
});

const refusing = (code: string, reason: (detail: string) => string, unblock: Unblock) =>
  placementRefusal((failure) => new GateRefusal(code, reason(failure.message), unblock));

const unreadable = (at: TargetAt) =>
  refusing(
    'target-unavailable',
    (detail) => `The destination of generation ${at.generation} of run ${at.runId} cannot be read: ${detail}`,
    ["Read the run's context changes, and try the call again once storage answers."],
  );

const unregistered = refusing('target-root-unavailable', (detail) => `The root this thread is placed in cannot be opened: ${detail}`, [
  'Select a registered root for this thread, or register the tree it should work in.',
]);
