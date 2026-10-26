import { Effect } from 'effect';
import type { Unit } from '../../platform/contract/service/units.js';
import {
  AssignmentRefused,
  AssignmentUnavailable,
  type Assignment,
  type AssignmentActor,
  type AssignmentFailure,
  type RootSelection,
  type RootState,
} from '../contract/wire/assignments.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { RootId } from '../contract/wire/ids.js';
import type { AssignmentStore, AssignmentStoreFailure } from '../store/assignments.js';
import { FileRoots } from '../contract/service/roots.js';
import { Assignments, ThreadLineage } from '../contract/service/assignments.js';

type AssignmentWork = AssignmentFailure | AssignmentStoreFailure;
export type AssignmentLedger = Assignments['Service'];

export const makeAssignmentLedger = Effect.fnUntraced(function* ({ store }: { readonly store: AssignmentStore }) {
  const roots = yield* FileRoots;
  const threads = yield* ThreadLineage;

  const admit = Effect.fn('Assignments.admit')(function* (actor: AssignmentActor, threadId: ThreadId, unit: Unit<'machine'>) {
    yield* project(threadId, unit);
    if (actor.kind === 'operator' || actor.threadId === threadId) return;
    yield* under(threadId, actor.threadId, 'child', unit);
  });

  const under = Effect.fn('Assignments.under')(function* (
    threadId: ThreadId,
    aboveId: ThreadId,
    lineage: 'child' | 'branch',
    unit: Unit<'machine'>,
  ) {
    yield* project(aboveId, unit);
    if (lineage === 'branch') return;
    if (!(yield* threads.isDescendant(threadId, aboveId, unit))) {
      return yield* new AssignmentRefused({
        threadId,
        reason: 'out-of-reach',
        message: `Thread ${aboveId} moves only itself and the threads spawned under it; ${threadId} is not below it.`,
      });
    }
  });

  const project = Effect.fn('Assignments.project')(function* (threadId: ThreadId, unit: Unit<'machine'>) {
    const projectId = yield* threads.projectOf(threadId, unit);
    if (projectId === undefined) {
      return yield* new AssignmentRefused({ threadId, reason: 'unknown-thread', message: `This surface holds no thread ${threadId}.` });
    }
    return projectId;
  });

  const assignment = Effect.fn('Assignments.assignment')(function* (
    threadId: ThreadId,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<Assignment, AssignmentWork> {
    const stored = yield* store.assignment(threadId, unit);
    return { threadId, ...stored, standing: yield* rootStanding(stored.selection, unit) };
  });

  const rootStanding = Effect.fn('Assignments.rootStanding')(function* (
    selection: RootSelection,
    unit: Unit<'machine'>,
  ): Effect.fn.Return<RootState, AssignmentWork> {
    if (selection.rootId === null) return 'none';
    return (yield* roots.live([selection.rootId], unit)).length === 0 ? 'gone' : 'live';
  });

  function failure(error: AssignmentWork, threadId?: ThreadId, rootId?: RootId): AssignmentFailure {
    switch (error._tag) {
      case 'AssignmentRefused':
      case 'AssignmentUnavailable':
      case 'RootMissing':
      case 'RootUnavailable':
      case 'RootInvalid':
      case 'RootConflict':
      case 'RootRefused':
        return error;
      default:
        return new AssignmentUnavailable({ threadId, rootId, message: error.message });
    }
  }

  return Assignments.of({
    read: Effect.fn('Assignments.read')(
      function* (unit, threadId) {
        yield* project(threadId, unit);
        return yield* assignment(threadId, unit);
      },
      (work, _unit, threadId) => Effect.mapError(work, (error) => failure(error, threadId)),
    ),
    mayAct: Effect.fn('Assignments.mayAct')(
      function* (actor, threadId, unit) {
        yield* admit(actor, threadId, unit);
      },
      (work, _actor, threadId, _unit) => Effect.mapError(work, (error) => failure(error, threadId)),
    ),
    enroll: Effect.fn('Assignments.enroll')(
      function* (unit, request) {
        yield* admit(request.actor, request.threadId, unit);
        const root = yield* roots.checked(request.root.rootId, request.root.locationRevision, unit);
        yield* store.enroll({ threadId: request.threadId, rootId: root.rootId, provenance: 'explicit' }, unit);
        return yield* assignment(request.threadId, unit);
      },
      (work, _unit, request) => Effect.mapError(work, (error) => failure(error, request.threadId, request.root.rootId)),
    ),
    withdraw: Effect.fn('Assignments.withdraw')(
      function* (unit, release) {
        yield* admit(release.actor, release.threadId, unit);
        const held = yield* store.assignment(release.threadId, unit);
        if (!held.memberships.some((membership) => membership.rootId === release.rootId)) {
          return yield* new AssignmentRefused({
            threadId: release.threadId,
            rootId: release.rootId,
            reason: 'not-a-member',
            message: 'This thread stands in no membership of that root.',
          });
        }
        if (held.selection.rootId === release.rootId) {
          return yield* new AssignmentRefused({
            threadId: release.threadId,
            rootId: release.rootId,
            reason: 'selected',
            message: "This root is the thread's selected one: clear the selection before the membership.",
          });
        }
        yield* store.withdraw(release.threadId, release.rootId, unit);
        return yield* assignment(release.threadId, unit);
      },
      (work, _unit, release) => Effect.mapError(work, (error) => failure(error, release.threadId, release.rootId)),
    ),
    select: Effect.fn('Assignments.select')(
      function* (unit, request) {
        yield* admit(request.actor, request.threadId, unit);
        const root = yield* roots.checked(request.root.rootId, request.root.locationRevision, unit);
        yield* store.enroll({ threadId: request.threadId, rootId: root.rootId, provenance: 'explicit' }, unit);
        yield* store.select(request.threadId, root.rootId, 'explicit', unit);
        return yield* assignment(request.threadId, unit);
      },
      (work, _unit, request) => Effect.mapError(work, (error) => failure(error, request.threadId, request.root.rootId)),
    ),
    clear: Effect.fn('Assignments.clear')(
      function* (unit, target) {
        yield* admit(target.actor, target.threadId, unit);
        yield* store.select(target.threadId, null, 'cleared', unit);
        return yield* assignment(target.threadId, unit);
      },
      (work, _unit, target) => Effect.mapError(work, (error) => failure(error, target.threadId)),
    ),
    inherit: Effect.fn('Assignments.inherit')(
      function* (unit, birth) {
        yield* project(birth.threadId, unit);
        if (birth.threadId === birth.parentThreadId) {
          return yield* new AssignmentRefused({
            threadId: birth.threadId,
            reason: 'out-of-reach',
            message: `Thread ${birth.threadId} names itself as the thread it was born of.`,
          });
        }
        yield* under(birth.threadId, birth.parentThreadId, birth.lineage ?? 'child', unit);
        if (birth.root !== undefined) {
          const named = yield* roots.checked(birth.root.rootId, birth.root.locationRevision, unit);
          yield* store.enroll({ threadId: birth.threadId, rootId: named.rootId, provenance: 'explicit' }, unit);
          yield* store.select(birth.threadId, named.rootId, 'explicit', unit);
          return yield* assignment(birth.threadId, unit);
        }
        const parent = yield* store.selection(birth.parentThreadId, unit);
        if (parent.provenance === 'intrinsic') return yield* assignment(birth.threadId, unit);
        if (parent.rootId !== null) {
          const captured = yield* roots.checked(parent.rootId, undefined, unit);
          yield* store.enroll({ threadId: birth.threadId, rootId: captured.rootId, provenance: 'inherited' }, unit);
        }
        yield* store.select(birth.threadId, parent.rootId, 'inherited', unit);
        return yield* assignment(birth.threadId, unit);
      },
      (work, _unit, birth) => Effect.mapError(work, (error) => failure(error, birth.threadId)),
    ),
    place: Effect.fn('Assignments.place')(
      function* (unit, newborn) {
        yield* project(newborn.threadId, unit);
        const standing = yield* store.selection(newborn.threadId, unit);
        if (standing.provenance !== 'intrinsic') {
          return yield* new AssignmentRefused({
            threadId: newborn.threadId,
            reason: 'selected',
            message: 'This thread already stands somewhere; only its birth places it without an actor.',
          });
        }
        const root = yield* roots.checked(newborn.root.rootId, newborn.root.locationRevision, unit);
        yield* store.enroll({ threadId: newborn.threadId, rootId: root.rootId, provenance: 'explicit' }, unit);
        yield* store.select(newborn.threadId, root.rootId, 'explicit', unit);
        return yield* assignment(newborn.threadId, unit);
      },
      (work, _unit, newborn) => Effect.mapError(work, (error) => failure(error, newborn.threadId, newborn.root.rootId)),
    ),
    publish: Effect.fn('Assignments.publish')(
      function* (unit, threadId, revision) {
        yield* project(threadId, unit);
        const selection = yield* store.selection(threadId, unit);
        return { threadId, selection, standing: yield* rootStanding(selection, unit), current: selection.revision === revision };
      },
      (work, _unit, threadId, _revision) => Effect.mapError(work, (error) => failure(error, threadId)),
    ),
    holdersOf: Effect.fn('Assignments.holdersOf')(
      (unit, rootIds) => store.holders(rootIds, unit),
      (work) => Effect.mapError(work, (error) => failure(error)),
    ),
  });
});
