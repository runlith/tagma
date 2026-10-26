import { expect, test } from 'bun:test';
import { WorktreeRevision, type WorktreeIntent } from './contract/wire/creation.js';
import {
  abandonmentSubjects,
  adoptionSubjects,
  creationSubjects,
  operationSubjects,
  reconciliationSubjects,
} from './contract/wire/subjects.js';
import { resolutionSubjects } from '../workspace/contract/wire/checkoutReads.js';

const record = (over: Partial<WorktreeIntent> = {}): WorktreeIntent =>
  ({
    operationId: 'made-once',
    projectId: 7,
    namespaceId: 'namespace-a',
    repository: { repositoryId: 'store-a', locationRevision: 3 },
    destination: '/checkouts/side',
    mode: { kind: 'new-branch', branch: 'feature', start: 'HEAD' },
    base: 'c0ffee',
    payloadDigest: 'digest',
    status: 'pending',
    reserved: false,
    rootId: null,
    evidence: null,
    abandonment: null,
    revision: WorktreeRevision.make(0),
    ...over,
  }) as WorktreeIntent;

test('a creation declares the directory, the ref and the store it will run', () => {
  expect(creationSubjects(record()).map((subject) => [subject.kind, subject.value])).toEqual([
    ['write', '/checkouts/side'],
    ['write', 'refs/heads/feature'],
    ['execute', 'worktree:git:store-a@3'],
  ]);
});

test('a detached creation declares no ref', () => {
  const subjects = creationSubjects(record({ mode: { kind: 'detached', start: 'c0ffee' } }));
  expect(subjects.map((subject) => subject.value)).toEqual(['/checkouts/side', 'worktree:git:store-a@3']);
});

test('a taking names the destination the operation reserved', () => {
  expect(adoptionSubjects(record({ status: 'uncertain', reserved: true })).map((subject) => subject.value)).toEqual(['/checkouts/side']);
});

test('reading an operation names the operation', () => {
  expect(operationSubjects('made-once')).toEqual([{ kind: 'read', value: 'worktree:operation:made-once' }]);
});

test('settling reads what releasing writes', () => {
  const standing = record({ status: 'uncertain', reserved: true, revision: WorktreeRevision.make(2) });
  const settling = reconciliationSubjects(standing);
  const releasing = abandonmentSubjects(standing);
  expect(releasing.map((subject) => subject.value)).toEqual(['/checkouts/side', 'refs/heads/feature']);
  expect(settling.map((subject) => subject.value)).toEqual(releasing.map((subject) => subject.value));
  expect(settling.every((subject) => subject.kind === 'read')).toBe(true);
  expect(releasing.every((subject) => subject.kind === 'write')).toBe(true);
});

test('a resolution names the place, not a spelling that walks out of one', () => {
  expect(resolutionSubjects('/checkouts/side')).toEqual([{ kind: 'read', value: '/checkouts/side', file: true }]);
  expect(resolutionSubjects('/checkouts/side/../../etc/shadow')).toEqual([{ kind: 'read', value: '/etc/shadow', file: true }]);
  expect(resolutionSubjects('/checkouts/./side/')).toEqual([{ kind: 'read', value: '/checkouts/side', file: true }]);
  expect(resolutionSubjects('side/../elsewhere')).toEqual([{ kind: 'read', value: 'side/../elsewhere', file: true }]);
});
