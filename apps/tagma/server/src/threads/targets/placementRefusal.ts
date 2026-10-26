import { Effect } from 'effect';
import { TargetStorageFailed } from '../contract/service/targetSnapshots.js';
import type { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { AssignmentRefused, AssignmentUnavailable, type AssignmentFailure } from '../../workspace/contract/wire/assignments.js';
import { RootConflict, RootInvalid, RootMissing, RootRefused, RootUnavailable } from '../../workspace/contract/wire/roots.js';
import { AssignmentStorageFailed } from '../../workspace/store/assignments.js';

export type PlacementFailure = AssignmentFailure | AssignmentStorageFailed | TargetStorageFailed;

const isPlacementFailure = <E>(failure: E): failure is Extract<E, PlacementFailure> =>
  failure instanceof AssignmentRefused ||
  failure instanceof AssignmentUnavailable ||
  failure instanceof AssignmentStorageFailed ||
  failure instanceof TargetStorageFailed ||
  failure instanceof RootMissing ||
  failure instanceof RootUnavailable ||
  failure instanceof RootInvalid ||
  failure instanceof RootConflict ||
  failure instanceof RootRefused;

export const placementRefusal =
  (refuse: (failure: PlacementFailure) => GateRefusal) =>
  <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.catchIf(work, isPlacementFailure, (failure) => Effect.fail(refuse(failure)));
