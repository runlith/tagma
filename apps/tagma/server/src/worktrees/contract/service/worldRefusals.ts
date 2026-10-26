import { GateRefusal, type Unblock } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRootFailure, ProjectRootsUnavailable } from '../../../workspace/contract/wire/coverage.js';
import type { RepositoryFailure } from '../../../workspace/contract/wire/repositories.js';
import type { RootResolutionFailure } from '../../../workspace/contract/wire/roots.js';
import type { WorktreeUnavailable } from '../wire/failures.js';

export type WorldFailure = WorktreeUnavailable | RootResolutionFailure | ProjectRootFailure | RepositoryFailure;

export type WorldFailureCodes = {
  readonly ProjectRootsUnavailable: `coverage-${ProjectRootsUnavailable['reason']}`;
  readonly WorktreeUnavailable: 'worktree-unavailable';
  readonly RepositoryMissing: 'repository-missing';
  readonly RepositoryConflict: 'repository-moved' | 'repository-replaced' | 'repository-inconclusive';
  readonly RepositoryBaseMissing: 'repository-unborn';
  readonly RepositoryInvalid: 'repository-inconclusive';
  readonly RepositoryUnreadable: 'repository-inconclusive';
  readonly RepositoryRefused: 'repository-inconclusive';
  readonly RepositoryUnavailable: 'repository-unavailable';
  readonly RootMissing: 'root-missing';
  readonly RootUnavailable: 'root-unavailable';
  readonly RootInvalid: 'root-inconclusive';
  readonly RootConflict: 'root-replaced' | 'destination-reserved' | 'root-inconclusive';
  readonly RootRefused: 'root-inconclusive';
};

export type WorldFailureCode<F extends WorldFailure = WorldFailure> = WorldFailureCodes[F['_tag']];

const RECOVERY: Unblock = [
  'read the operation: read_worktree_operation — an act reserved with no receipt is one whose end nobody observed',
  'resolve what stands at the destination: prepare_worktree_recovery',
];

export const HELD: Unblock = [
  'read the operation that holds it: read_worktree_operation',
  'take its checkout with adopt_worktree, or declare it finished with abandon_worktree',
];

const COVERAGE_WAYS: Unblock = [
  'coverage is taken when a managed terminal opens in this project, or when its checkout is read: read_checkout',
  'take it one of those ways, then ask again',
];

const ROOT_WAYS: Unblock = [
  'the root registry could not take the checkout this act observed: read the reason above',
  'nothing here removed what stands at the destination: read_worktree_operation',
];

export function worldFailureRefusal<F extends WorldFailure>(failure: F): GateRefusal<WorldFailureCode<F>>;
export function worldFailureRefusal(failure: WorldFailure): GateRefusal<WorldFailureCode> {
  switch (failure._tag) {
    case 'ProjectRootsUnavailable':
      return new GateRefusal<WorldFailureCodes['ProjectRootsUnavailable']>(`coverage-${failure.reason}`, failure.message, COVERAGE_WAYS);
    case 'WorktreeUnavailable':
      return new GateRefusal('worktree-unavailable', `${failure.message} (the ${failure.reason} reading is what stopped)`, RECOVERY);
    case 'RepositoryMissing':
      return new GateRefusal('repository-missing', failure.message, [
        'a creation is bound to a store this installation has registered; ask the operator to register it',
        'then prepare against the record that registration answered — prepare_worktree',
      ]);
    case 'RepositoryConflict':
      return failure.reason === 'moved'
        ? new GateRefusal('repository-moved', failure.message, [
            'the store stands at the second address this reason names; ask the operator to record the move',
            'then prepare against the location revision that follows it — prepare_worktree',
          ])
        : failure.reason === 'replaced'
          ? new GateRefusal('repository-replaced', failure.message, [
              'the registered address holds a different object than the store was registered over',
              'that is the operator’s to settle; nothing here decides the fate of a store it was asked about',
            ])
          : new GateRefusal('repository-inconclusive', failure.message, [
              'the registry could not reach an answer about that store: read the reason above',
            ]);
    case 'RepositoryBaseMissing':
      return new GateRefusal('repository-unborn', failure.message, [
        'commit something to the store, so a creation has an object to stand on',
      ]);
    case 'RepositoryInvalid':
    case 'RepositoryUnreadable':
    case 'RepositoryRefused':
      return new GateRefusal('repository-inconclusive', failure.message, [
        'the registry could not reach an answer about that store: read the reason above',
      ]);
    case 'RepositoryUnavailable':
      return new GateRefusal('repository-unavailable', failure.message, [
        'a reading of that store could not be taken: read the reason above',
      ]);
    case 'RootMissing':
      return new GateRefusal('root-missing', failure.message, ROOT_WAYS);
    case 'RootUnavailable':
      return new GateRefusal('root-unavailable', failure.message, ROOT_WAYS);
    case 'RootInvalid':
      return new GateRefusal('root-inconclusive', failure.message, ROOT_WAYS);
    case 'RootRefused':
      return new GateRefusal('root-inconclusive', failure.message, ROOT_WAYS);
    case 'RootConflict':
      if (failure.reason === 'reserved') return new GateRefusal('destination-reserved', failure.message, HELD);
      return failure.reason === 'replaced'
        ? new GateRefusal('root-replaced', failure.message, ROOT_WAYS)
        : new GateRefusal('root-inconclusive', failure.message, ROOT_WAYS);
  }
}
