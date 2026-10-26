import { expect, test } from 'bun:test';
import { NamespaceId } from '@runlith/files/namespace';
import { RootConflict, RootInvalid, RootMissing, RootRefused, RootUnavailable } from '../contract/wire/roots.js';
import { projectRootRefusal, repositoryReadRefusal, rootReadRefusal } from './refusal.js';
import { ProjectRootsUnavailable } from '../contract/wire/coverage.js';
import { RepositoryConflict, RepositoryMissing, RepositoryUnavailable } from '../contract/wire/repositories.js';

const namespaceId = NamespaceId.make('roots-refusal');
const path = '/checkout';
const message = 'said';

test('each root read failure answers its admitted code', () => {
  const codes = [
    new RootMissing({ namespaceId, message }),
    new RootUnavailable({ namespaceId, reason: 'storage', message }),
    new RootInvalid({ namespaceId, path, reason: 'not-directory', message }),
    new RootRefused({ namespaceId, path, reason: 'foreign-namespace', message }),
    new RootConflict({ namespaceId, path, reason: 'replaced', message }),
    new RootConflict({ namespaceId, path, reason: 'stale-binding', message }),
  ].map((failure) => rootReadRefusal(failure).code);
  expect(codes).toEqual([
    'root-missing',
    'root-unavailable',
    'root-inconclusive',
    'root-inconclusive',
    'root-replaced',
    'root-inconclusive',
  ]);
});

test('a reservation conflict on a read is a defect, never a refusal', () => {
  expect(() => rootReadRefusal(new RootConflict({ namespaceId, path, reason: 'reserved', message }))).toThrow();
});

test('coverage and repository failures use workspace-owned refusal codes', () => {
  expect(projectRootRefusal(new ProjectRootsUnavailable({ projectId: 1, reason: 'environment', message })).code).toBe('coverage-registry');
  expect(repositoryReadRefusal(new RepositoryMissing({ namespaceId, message })).code).toBe('repository-missing');
  expect(repositoryReadRefusal(new RepositoryConflict({ namespaceId, reason: 'moved', message })).code).toBe('repository-moved');
  expect(repositoryReadRefusal(new RepositoryUnavailable({ namespaceId, reason: 'storage', message })).code).toBe('repository-unavailable');
});
