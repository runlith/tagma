import { dirname, isAbsolute } from 'node:path';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { pathSubject } from '@runlith/agent/permissions/pathSubject';
import type { Caller } from '../wire/caller.js';

export function callerPath(caller: Caller, named: string): string;
export function callerPath(caller: Caller, named: string | undefined): string | undefined;
export function callerPath(caller: Caller, named: string | undefined): string | undefined {
  return named === undefined ? undefined : (caller.files?.resolve(named) ?? named);
}

export const readSubject = (target: string): PermissionSubject => ({ kind: 'read', value: target, file: true });

export const rootedSubjects = (root: string | undefined, subjects: readonly PermissionSubject[]): readonly PermissionSubject[] =>
  root === undefined
    ? subjects
    : subjects.map((subject) => (subject.file === true ? pathSubject(subject.kind, root, subject.value) : subject));

export const writeSubject = (target: string): PermissionSubject => ({ kind: 'write', value: target, file: true });

export const callerReads = (caller: Caller, named: string | undefined): readonly PermissionSubject[] => {
  const target = callerPath(caller, named);
  return target === undefined || !isAbsolute(target) ? [] : [readSubject(target)];
};

export const documentReads = (caller: Caller, named: string | undefined): readonly PermissionSubject[] => {
  const target = callerPath(caller, named);
  if (target === undefined || !isAbsolute(target)) return [];
  return [readSubject(target), readSubject(dirname(target))];
};
