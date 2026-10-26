import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type {
  Assignment,
  AssignmentActor,
  AssignmentBirth,
  AssignmentFailure,
  AssignmentInput,
  AssignmentTarget,
  Membership,
  MembershipRelease,
  Publication,
  SelectionRevision,
} from '../wire/assignments.js';
import type { RootId } from '../wire/ids.js';
import type { RootBinding } from '../wire/roots.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';

export class ThreadLineage extends Context.Service<
  ThreadLineage,
  {
    projectOf(threadId: ThreadId, unit: Unit<'machine'>): Effect.Effect<number | undefined, StoreFailure>;
    isDescendant(threadId: ThreadId, ancestorId: ThreadId, unit: Unit<'machine'>): Effect.Effect<boolean, StoreFailure>;
  }
>()('tagma/workspace/ThreadLineage') {}

export class Assignments extends Context.Service<
  Assignments,
  {
    read(unit: Unit<'machine'>, threadId: ThreadId): Effect.Effect<Assignment, AssignmentFailure>;
    mayAct(actor: AssignmentActor, threadId: ThreadId, unit: Unit<'machine'>): Effect.Effect<void, AssignmentFailure>;
    enroll(unit: WriteUnit<'machine'>, request: AssignmentInput): Effect.Effect<Assignment, AssignmentFailure>;
    withdraw(unit: WriteUnit<'machine'>, release: MembershipRelease): Effect.Effect<Assignment, AssignmentFailure>;
    select(unit: WriteUnit<'machine'>, request: AssignmentInput): Effect.Effect<Assignment, AssignmentFailure>;
    clear(unit: WriteUnit<'machine'>, target: AssignmentTarget): Effect.Effect<Assignment, AssignmentFailure>;
    inherit(unit: WriteUnit<'machine'>, birth: AssignmentBirth): Effect.Effect<Assignment, AssignmentFailure>;
    place(
      unit: WriteUnit<'machine'>,
      newborn: { readonly threadId: ThreadId; readonly root: RootBinding },
    ): Effect.Effect<Assignment, AssignmentFailure>;
    publish(unit: Unit<'machine'>, threadId: ThreadId, revision: SelectionRevision): Effect.Effect<Publication, AssignmentFailure>;
    holdersOf(unit: Unit<'machine'>, rootIds: readonly RootId[]): Effect.Effect<readonly Membership[], AssignmentFailure>;
  }
>()('tagma/workspace/Assignments') {}
