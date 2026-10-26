import { RequestKey } from '../../../platform/contract/wire/ids.js';
import { expect, test } from 'bun:test';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { CREATION_OPERATION_IDS, CREATION_OPERATIONS } from '../wire/operations/creation.js';
import { EnvironmentId, EnvironmentUseId } from '../../../workspace/contract/wire/environments.js';
import {
  RepositoryId,
  RepositoryConflict,
  RepositoryMissing,
  RepositoryUnavailable,
  RepositoryBaseMissing,
  RepositoryInvalid,
  RepositoryUnreadable,
  RepositoryRefused,
} from '../../../workspace/contract/wire/repositories.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { RootConflict, RootInvalid, RootMissing, RootUnavailable } from '../../../workspace/contract/wire/roots.js';

import { WORKTREE_REFUSALS, WorktreeMissing, WorktreeRefused, WorktreeUnavailable } from '../wire/failures.js';
import type { WorktreeActFailure } from './creation.js';
import { worktreeRefusal } from './refusals.js';

const named = new Set<string>(CREATION_OPERATION_IDS.flatMap((id) => [...CREATION_OPERATIONS[id].refusals]));

const operationId = RequestKey.make('any');
const namespaceId = NamespaceId.make('namespace');
const repositoryId = RepositoryId.make('store');
const rootId = RootId.make('root');
const locationRevision = LocationRevision.make(0);
const reasons = WORKTREE_REFUSALS;
const environmentId = EnvironmentId.make('environment');
const identityWitness = { provider: 'effect/FileSystem', format: 'stat-coordinate-birthtime', token: 'token' };
const binding = { environmentId, kind: 'host' as const, namespaceId, identityWitness };
const useId = EnvironmentUseId.make('use-1');

const EVERY_FAILURE: readonly WorktreeActFailure[] = [
  ...reasons.map((reason) => new WorktreeRefused({ operationId, reason, message: 'why' })),
  new WorktreeMissing({ operationId, message: 'why' }),
  ...(['storage', 'filesystem', 'git'] as const).map((reason) => new WorktreeUnavailable({ operationId, reason, message: 'why' })),
  new RepositoryMissing({ namespaceId, repositoryId, message: 'why' }),
  new RepositoryUnavailable({ namespaceId, repositoryId, reason: 'git', message: 'why' }),
  new RepositoryConflict({ repositoryId, namespaceId, commonDirectory: '/store', locationRevision, reason: 'replaced', message: 'why' }),
  new RepositoryConflict({
    repositoryId,
    namespaceId,
    locationRevision,
    registered: '/store',
    found: '/elsewhere',
    reason: 'moved',
    message: 'why',
  }),
  new RepositoryConflict({ namespaceId, path: '/store', reason: 'registry-changed', message: 'why' }),
  new RepositoryBaseMissing({ repositoryId, namespaceId, commonDirectory: '/store', ref: 'refs/heads/main', message: 'why' }),
  new RepositoryInvalid({ namespaceId, path: '/store', reason: 'relative-path', message: 'why' }),
  new RepositoryUnreadable({ namespaceId, path: '/store', message: 'why' }),
  new RepositoryRefused({ namespaceId, path: '/store', reason: 'discovery-overridden', message: 'why' }),
  new RepositoryMissing({ namespaceId, path: '/store', reason: 'no-repository', message: 'why' }),
  new RootMissing({ namespaceId, path: '/checkout', message: 'why' }),
  new RootUnavailable({ namespaceId, path: '/checkout', reason: 'filesystem', message: 'why' }),
  new RootConflict({ rootId, namespaceId, path: '/checkout', locationRevision, reason: 'replaced', message: 'why' }),
  new RootInvalid({ namespaceId, path: '/checkout', reason: 'not-directory', message: 'why' }),
  new RootConflict({ namespaceId, path: '/checkout', reason: 'reserved', message: 'why' }),
  { _tag: 'EnvironmentRegistryUnavailable', reason: 'the ledger did not answer' },
  { _tag: 'EnvironmentUnavailable', binding, witnessed: true, reason: 'not serving' },
  { _tag: 'EnvironmentReplaced', binding, current: identityWitness },
  { _tag: 'EnvironmentAccessDenied', binding, reason: 'denied' },
  { _tag: 'EnvironmentUseConflict', binding, held: [], holders: 1, standing: 1 },
  { _tag: 'EnvironmentUseMissing', useId },
  { _tag: 'EnvironmentUseResolved', useId, outcome: 'released' },
  { _tag: 'ActivationUnsupported', kind: 'host', binding: null, capability: 'exec', reason: 'not served' },
];

test('every code this binding raises is a refusal some worktree operation names', () => {
  const unnamed = EVERY_FAILURE.map((failure) => worktreeRefusal(failure).code).filter((code) => !named.has(code));
  expect([...new Set(unnamed)]).toEqual([]);
});

test('every reason the owner can refuse with is a code some worktree operation names', () => {
  expect(reasons.filter((reason) => !named.has(reason))).toEqual([]);
});

test('a refusal reaches every surface under the owner’s own word', () => {
  const renamed = reasons.filter((reason) => worktreeRefusal(new WorktreeRefused({ operationId, reason, message: 'why' })).code !== reason);
  expect(renamed).toEqual([]);
});

test('a place somebody has spoken for is answered as a reservation, not as a storage failure', () => {
  const held = worktreeRefusal(new RootConflict({ namespaceId, path: '/checkout', reason: 'reserved', message: 'held' }));
  expect(held.code).toBe('destination-reserved');
  const other = worktreeRefusal(new RootInvalid({ namespaceId, path: '/checkout', reason: 'not-directory', message: 'why' }));
  expect(other.code).toBe('root-inconclusive');
});

test('an act from another address space is answered with where to act instead', () => {
  for (const reason of ['foreign-namespace', 'foreign-environment'] as const) {
    const refused = worktreeRefusal(new WorktreeRefused({ operationId, reason, message: 'why' }));
    expect(refused.code).toBe(reason);
    expect(refused.unblock.join(' ')).toContain('host environment of this installation');
  }
});
