import { GateRefusal, type Unblock } from '../../platform/contract/wire/refusal.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import type { ProjectRootFailure } from '../contract/wire/coverage.js';
import type { RepositoryFailure } from '../contract/wire/repositories.js';
import type { PlaceRefusal, RootRefusal } from '../contract/wire/refusals.js';

const ROOT_WAYS: Unblock = [
  'the root registry could not take the checkout this act observed: read the reason above',
  'nothing here removed what stands at the destination: read_worktree_operation',
];

export const rootReadRefusal = (failure: RootResolutionFailure): GateRefusal<RootRefusal> => {
  switch (failure._tag) {
    case 'RootMissing':
      return new GateRefusal('root-missing', failure.message, ROOT_WAYS);
    case 'RootUnavailable':
      return new GateRefusal('root-unavailable', failure.message, ROOT_WAYS);
    case 'RootInvalid':
    case 'RootRefused':
      return new GateRefusal('root-inconclusive', failure.message, ROOT_WAYS);
    case 'RootConflict':
      if (failure.reason === 'reserved') {
        throw new Error(`a root read answered a reservation conflict, which only registration raises: ${failure.message}`);
      }
      return failure.reason === 'replaced'
        ? new GateRefusal('root-replaced', failure.message, ROOT_WAYS)
        : new GateRefusal('root-inconclusive', failure.message, ROOT_WAYS);
  }
};

export const repositoryReadRefusal = (failure: RepositoryFailure): GateRefusal<PlaceRefusal> => {
  switch (failure._tag) {
    case 'RepositoryMissing':
      return new GateRefusal('repository-missing', failure.message, [
        'read the repositories this project covers, then choose a registered store',
      ]);
    case 'RepositoryConflict':
      return failure.reason === 'moved'
        ? new GateRefusal('repository-moved', failure.message, ['record the store move, then read its new location revision'])
        : failure.reason === 'replaced'
          ? new GateRefusal('repository-replaced', failure.message, ['settle the replaced store with its operator'])
          : new GateRefusal('repository-inconclusive', failure.message, ['read what the registry said and settle its binding']);
    case 'RepositoryBaseMissing':
      return new GateRefusal('repository-unborn', failure.message, ['make a first commit in the store, then read it again']);
    case 'RepositoryUnavailable':
      return new GateRefusal('repository-unavailable', failure.message, ['read the store again once its repository and storage answer']);
    case 'RepositoryInvalid':
    case 'RepositoryUnreadable':
    case 'RepositoryRefused':
      return new GateRefusal('repository-inconclusive', failure.message, ['read what the registry said and settle its binding']);
  }
};

export const projectRootRefusal = (failure: ProjectRootFailure): GateRefusal<PlaceRefusal> => {
  switch (failure._tag) {
    case 'ProjectRootsUnavailable':
      return new GateRefusal(failure.reason === 'environment' ? 'coverage-registry' : `coverage-${failure.reason}`, failure.message, [
        'read the project coverage again once its registry and checkout answer',
      ]);
    case 'RootMissing':
    case 'RootUnavailable':
    case 'RootInvalid':
    case 'RootRefused':
    case 'RootConflict':
      return rootReadRefusal(failure);
    default:
      return repositoryReadRefusal(failure);
  }
};
