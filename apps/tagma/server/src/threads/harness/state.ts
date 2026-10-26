import { Effect } from 'effect';
import type { ThreadState } from '@runlith/agent/thread/state';
import { ThreadCallBroke, type ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { spawnDepthAt } from '@runlith/agent/collaboration/ThreadSpawnAccess';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { stored } from '../../platform/store/crossing.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { DEFAULT_TITLE } from '../../thread-record/contract/wire/title.js';
import { makeAssignmentStore } from '../../workspace/store/assignments.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { failedAs } from '../contract/service/failure.js';
import { SessionRead } from '../contract/service/harness.js';
import { ThreadMandate } from '../contract/service/mandate.js';
import { ThreadRecaps } from '../contract/service/recaps.js';
import { ThreadPins } from '../contract/service/pins.js';
import type { NativeThreadState } from '../contract/service/state.js';
import { subAgentDepth } from '../contract/wire/settings.js';
import { readDelegation } from '../birth/delegation.js';
import { readApproves, type StandingOf } from '../approvers.js';

export type SubAgentDepths = Effect.Success<typeof makeSubAgentDepths>;

export const makeSubAgentDepths = Effect.gen(function* () {
  const records = yield* ThreadRecords;
  const settings = yield* Settings;
  return {
    of: Effect.fnUntraced(function* (spawnRootId: string) {
      const projectId = yield* records.projectOf(spawnRootId).pipe(stored('projectOf'));
      const resolved = yield* settings.read(subAgentDepth, projectId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
      return resolved.value;
    }),
  };
});

export const makeEngineStates = Effect.fnUntraced(function* ({
  depths,
  standingOf,
}: {
  readonly depths: SubAgentDepths;
  readonly standingOf: StandingOf;
}) {
  const records = yield* ThreadRecords;
  const sessionOf = yield* SessionRead;
  const recaps = yield* ThreadRecaps;
  const mandate = yield* ThreadMandate;
  const settings = yield* Settings;
  const modes = yield* ApprovalModes;
  const units = yield* MachineUnits;
  const assignments = makeAssignmentStore({ db: (yield* MachineStore).db });
  const worktrees = yield* WorktreeRecords;
  const pins = yield* ThreadPins;

  const approving = Effect.fnUntraced(function* (threadId: string) {
    const stand = yield* standingOf(threadId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause })));
    const projectId = (yield* records.projectOf(threadId).pipe(stored('projectOf'))) ?? 0;
    const grant = yield* readApproves(mandate, settings, threadId, projectId).pipe(stored('approves'));
    return {
      approver: stand.approver,
      why: stand.why,
      takenOver: stand.why === 'taken-over',
      approves: { own: grant.own, effective: grant.effective, origin: grant.origin, setAt: grant.setAt },
    };
  });

  const standing = Effect.fnUntraced(function* (threadId: string) {
    const { facts, harness } = yield* failedAs('title', Effect.all({ facts: records.facts(threadId), harness: sessionOf(threadId) }));
    const ancestorId = facts?.parentId ?? facts?.detachedFrom;
    const ancestor = ancestorId == null ? undefined : yield* failedAs('parent', records.facts(ancestorId));
    const address = ancestor?.projectId == null ? undefined : { id: ancestor.id, projectId: ancestor.projectId, title: ancestor.title };
    const recap = yield* failedAs('recap', recaps.reading({ id: threadId, projectId: facts?.projectId ?? null }, facts?.recap ?? null));
    return {
      title: facts?.title ?? DEFAULT_TITLE,
      ...(address === undefined ? {} : facts?.parentId == null ? { detachedFrom: address } : { parent: address }),
      harness,
      recap,
      recapAttempt: recaps.attempt(threadId),
    };
  });

  const placeOf = Effect.fnUntraced(function* (threadId: string) {
    return yield* units.read((unit) =>
      Effect.gen(function* () {
        const selected = (yield* assignments.selection(ThreadId.make(threadId), unit)).rootId;
        if (selected === null) return null;
        const record = yield* worktrees.byRoot(selected, unit);
        return { rootId: selected as string, branch: record?.branch ?? null };
      }),
    );
  });

  return {
    of: Effect.fn('EngineStates.of')(function* (state: ThreadState): Effect.fn.Return<NativeThreadState, ThreadBorderFailed> {
      return yield* Effect.all({
        standing: standing(state.thread.id),
        pins: pins.read(state.thread.id).pipe(stored('pins')),
        delegation: readDelegation(mandate, settings, state.thread.id).pipe(stored('delegation')),
        approving: approving(state.thread.id),
        limit: depths.of(state.thread.spawnRootId),
        place: Effect.mapError(placeOf(state.thread.id), (cause) => new ThreadStorageFailed({ call: 'place', cause })),
      }).pipe(
        Effect.map(({ standing, delegation, approving, limit, place, pins }) => ({
          pins,
          ...state,
          ...standing,
          delegation: delegation.delegation,
          approving,
          spawnDepth: spawnDepthAt(delegation.depth, limit),
          place,
          modes: modes.declared(),
        })),
      );
    }),
  };
});
