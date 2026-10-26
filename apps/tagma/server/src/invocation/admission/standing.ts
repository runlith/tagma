import { Effect } from 'effect';
import type { AgentApprovalMode } from '@runlith/agent/contracts';
import { isThreadBorderFailure } from '@runlith/agent/thread/ThreadBorder';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { TargetStorageFailed, type TargetSnapshots } from '../../threads/contract/service/targetSnapshots.js';
import type { TargetPreparation } from '../../threads/contract/service/preparation.js';
import type { ThreadLookup } from '../../threads/contract/service/reads.js';
import { atOf, originOf } from '../../threads/contract/wire/target.js';
import { WorldUnavailable, type Worlds } from '../../executions/contract/service/worlds.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import type { CallerWorkspace } from '../../workspace/contract/service/places.js';
import type { ThreadStanding } from '../contract/service/admission.js';

export type ThreadPlaces = {
  readonly units: MachineUnits['Service'];
  readonly snapshots: TargetSnapshots['Service'];
  readonly targets: TargetPreparation['Service'];
  readonly worlds: Worlds['Service'];
  readonly threads: ThreadLookup['Service'];
};

export type CallingThread = { readonly id: string; readonly ownerId: string };

export type StandingThread = CallingThread & { readonly projectId: number; readonly root: string };

export type Stood = {
  readonly standing: ThreadStanding;
  readonly place: NonNullable<CallerWorkspace['Service']>;
  readonly checkout: string;
  readonly authority: AgentApprovalMode;
};

const unplaced = (threadId: string, failure: { readonly message: string }) =>
  new GateRefusal('world-unavailable', `The world of thread ${threadId} cannot be opened: ${failure.message}`, [
    "make the call again once the thread's host answers",
  ]);

const rowOf = (places: ThreadPlaces, thread: CallingThread) =>
  places.threads
    .find(thread.id, thread.ownerId)
    .pipe(Effect.mapError((failure) => (isThreadBorderFailure(failure) ? unplaced(thread.id, failure) : failure)));

export const authorityOf = (places: ThreadPlaces) =>
  Effect.fn('invocation.authority')(function* (
    thread: CallingThread,
  ): Effect.fn.Return<AgentApprovalMode | null, StoreFailure | GateRefusal> {
    return (yield* rowOf(places, thread))?.authority.mode ?? null;
  });

export const standingOf = (places: ThreadPlaces) =>
  Effect.fn('invocation.standing')(function* (thread: StandingThread): Effect.fn.Return<Stood, StoreFailure | GateRefusal> {
    const row = yield* rowOf(places, thread);
    if (row === undefined) {
      return yield* new GateRefusal('not-found', `Thread ${thread.id} is gone, so it has no world to call from.`, [
        'call from a thread that stands',
      ]);
    }
    const active = yield* places.units
      .read((unit) => places.snapshots.readActive(thread.id, unit))
      .pipe(Effect.mapError((failure) => (failure instanceof TargetStorageFailed ? unplaced(thread.id, failure) : failure)));
    const acquire = (request: { readonly at: TargetAt; readonly root: string }) =>
      places.worlds.of({ thread: row, at: request.at, root: request.root });
    const admitted = yield* (
      active.state === 'admitted'
        ? Effect.map(acquire({ at: atOf(active.target), root: active.target.workingRoot }), (acquired) => ({
            target: active.target,
            world: acquired.world,
          }))
        : places.targets.of(
            { id: thread.id, projectId: thread.projectId, root: thread.root },
            { kind: 'tools', runId: null, context: null },
            acquire,
          )
    ).pipe(Effect.mapError((failure) => (failure instanceof WorldUnavailable ? unplaced(thread.id, failure) : failure)));
    return {
      standing: {
        world: admitted.world,
        runId: active.state === 'admitted' ? active.target.runId : active.reason === 'no-target' ? active.runId : null,
        projectRoot: thread.root,
      },
      place: { root: admitted.world.root, origin: originOf(admitted.target) },
      checkout: admitted.target.graph.root,
      authority: row.authority.mode,
    };
  });
