import { GateRefusal, type Unblock } from '../../../platform/contract/wire/refusal.js';
import type { WorktreeRefused } from '../wire/failures.js';
import type { FinishFailure } from '../wire/failures.js';
import { HELD, worldFailureRefusal, type WorldFailureCodes } from './worldRefusals.js';
import type { WorktreeActFailure } from './creation.js';

const UNRECONCILED: Unblock = [
  'read the operation: read_worktree_operation — its producer says which of these applies',
  'a producer that is not this installation is settled by reconcile_worktree, which records what it left',
  'a producer that IS this installation may be writing this second: wait for it to end, and read again',
];

type WorktreeRefusalCodes = WorldFailureCodes & {
  readonly WorktreeRefused: WorktreeRefused['reason'];
  readonly WorktreeMissing: 'not-found';
  readonly WorktreeHostUnreadable: 'environment-unavailable';
  readonly EnvironmentUnavailable: 'environment-unavailable';
  readonly EnvironmentReplaced: 'environment-unavailable';
  readonly EnvironmentAccessDenied: 'environment-unavailable';
  readonly EnvironmentUseConflict: 'environment-unavailable';
  readonly ActivationUnsupported: 'environment-unavailable';
  readonly EnvironmentRegistryUnavailable: 'environment-unavailable';
  readonly EnvironmentUseMissing: 'environment-unavailable';
  readonly EnvironmentUseResolved: 'environment-unavailable';
};

export type WorktreeRefusalCode<F extends WorktreeActFailure = WorktreeActFailure> = WorktreeRefusalCodes[F['_tag']];

const REFUSAL_WAYS: Readonly<Record<WorktreeRefused['reason'], Unblock>> = {
  'changed-payload': [
    'name a fresh operation id: a second act takes a name of its own',
    'read what already stands under this name: read_worktree_operation',
  ],
  'relative-path': ['name the destination as an absolute path in the namespace this installation registers roots in'],
  'parent-missing': ['make the parent directory, then prepare the creation again'],
  'destination-occupied': [
    'name a destination that does not stand',
    'clear the place yourself: nothing here removes what is already there',
  ],
  'destination-reserved': HELD,
  'ref-reserved': HELD,
  'ref-occupied': ['name a branch that does not exist yet', 'check out the branch that does: mode `existing-branch`'],
  'ref-missing': ['name a branch that exists', 'create one at a start point: mode `new-branch`'],
  'base-absent': [
    'name a start point this store resolves to a commit',
    'the base of a creation that already stands is fixed: open a fresh one — prepare_worktree',
  ],
  'foreign-namespace': [
    'act from the host environment of this installation: a creation resolves paths in the address space these roots are registered in, and nothing here carries it into another',
  ],
  'foreign-environment': [
    'act from the host environment of this installation: a creation runs on this machine, and nothing here reaches a guest',
  ],
  'foreign-project': ['ask under the project this operation was prepared for', 'prepare a creation of your own: prepare_worktree'],
  settled: ['read the outcome and its receipt: read_worktree_operation'],
  abandoned: ['prepare a fresh creation under a name of its own: prepare_worktree'],
  unreconciled: UNRECONCILED,
  'observed-changed': [
    'resolve the recovery again over what stands there now: prepare_worktree_recovery',
    'the approval was over the object that was found, and the place holds another',
  ],
  unreserved: ['nothing authorized a checkout under this name', 'run the prepared creation: create_worktree'],
  'stale-revision': ['read the operation again and decide over the revision it stands at now: read_worktree_operation'],
  'observed-mismatch': ['name the directory this creation reserved', 'read the destination it was prepared for: read_worktree_operation'],
};

export function worktreeRefusal<F extends WorktreeActFailure>(failure: F): GateRefusal<WorktreeRefusalCode<F>>;
export function worktreeRefusal(failure: WorktreeActFailure): GateRefusal<WorktreeRefusalCode> {
  switch (failure._tag) {
    case 'WorktreeRefused':
      return new GateRefusal(failure.reason, failure.message, REFUSAL_WAYS[failure.reason]);
    case 'WorktreeMissing':
      return new GateRefusal('not-found', failure.message, [
        'an operation id is the caller\u2019s own name for one act; nothing here mints one',
        'open a creation under this name: prepare_worktree',
      ]);
    case 'WorktreeHostUnreadable':
      return new GateRefusal('environment-unavailable', failure.message, HOST_WAYS);
    case 'EnvironmentUnavailable':
      return new GateRefusal('environment-unavailable', `${failure.binding.environmentId}: ${failure.reason}`, HOST_WAYS);
    case 'EnvironmentReplaced':
      return new GateRefusal(
        'environment-unavailable',
        `The ${failure.binding.kind} environment ${failure.binding.environmentId} answers for a different object than this act was resolved over.`,
        HOST_WAYS,
      );
    case 'EnvironmentAccessDenied':
      return new GateRefusal('environment-unavailable', failure.reason, HOST_WAYS);
    case 'EnvironmentUseConflict':
      return new GateRefusal(
        'environment-unavailable',
        `${failure.holders} consumer${failure.holders === 1 ? '' : 's'} hold ${failure.standing} use${failure.standing === 1 ? '' : 's'} of ${failure.binding.environmentId}.`,
        HOST_WAYS,
      );
    case 'ActivationUnsupported':
      return new GateRefusal(
        'environment-unavailable',
        `The ${failure.kind} environment does not serve ${failure.capability}: ${failure.reason}`,
        HOST_WAYS,
      );
    case 'EnvironmentRegistryUnavailable':
      return new GateRefusal('environment-unavailable', failure.reason, HOST_WAYS);
    case 'EnvironmentUseMissing':
      return new GateRefusal('environment-unavailable', `No use ${failure.useId} stands for this caller.`, HOST_WAYS);
    case 'EnvironmentUseResolved':
      return new GateRefusal(
        'environment-unavailable',
        `The use ${failure.useId} was given back and stands as ${failure.outcome}.`,
        HOST_WAYS,
      );
    default:
      return worldFailureRefusal(failure);
  }
}

export const finishingRefusal = (failure: FinishFailure): GateRefusal =>
  failure._tag === 'WorktreeFinishRefused' ? new GateRefusal(failure.reason, failure.message, failure.unblock) : worktreeRefusal(failure);

const HOST_WAYS: Unblock = [
  'this installation could not take the machine a creation runs on: read the reason above',
  'nothing of the operation was touched; ask again once the environment answers for itself',
];
