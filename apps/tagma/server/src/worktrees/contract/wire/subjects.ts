import type { PermissionSubject } from '@runlith/agent/permissions';
import { refOf, type WorktreeIntent } from './creation.js';

const named = (kind: PermissionSubject['kind'], value: string): PermissionSubject => ({ kind, value });

const folder = (kind: 'read' | 'write', destination: string): PermissionSubject => ({ kind, value: destination, file: true });

const storeValue = (operation: WorktreeIntent): string =>
  `worktree:git:${operation.repository.repositoryId}@${operation.repository.locationRevision}`;

export function creationSubjects(operation: WorktreeIntent): readonly PermissionSubject[] {
  const ref = refOf(operation.mode);
  return [folder('write', operation.destination), ...(ref === null ? [] : [named('write', ref)]), named('execute', storeValue(operation))];
}

export function adoptionSubjects(operation: WorktreeIntent): readonly PermissionSubject[] {
  return [folder('write', operation.destination)];
}

export function abandonmentSubjects(operation: WorktreeIntent): readonly PermissionSubject[] {
  const ref = refOf(operation.mode);
  return [folder('write', operation.destination), ...(ref === null ? [] : [named('write', ref)])];
}

export function reconciliationSubjects(operation: WorktreeIntent): readonly PermissionSubject[] {
  const ref = refOf(operation.mode);
  return [folder('read', operation.destination), ...(ref === null ? [] : [named('read', ref)])];
}

export function operationSubjects(operationId: string): readonly PermissionSubject[] {
  return [{ kind: 'read', value: `worktree:operation:${operationId}` }];
}
