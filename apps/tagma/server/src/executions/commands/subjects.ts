import type { PermissionSubject } from '@runlith/agent/permissions';
import type { CommandRevision, DeadlineChange } from '@runlith/executions/protocol/command';
import type { ExecutionRef, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { EnvironmentBinding } from '../../workspace/contract/wire/environments.js';
import type { CommandSubject } from '../contract/wire/commandSubject.js';
import { targetCwd, type ResolvedExecutionTarget, type TargetKey } from '../contract/wire/targets.js';
import { commandLine } from '../contract/wire/terminals.js';
import { encode, placeProject, spell } from '../terminals/subjectPolicy.js';
import { type TerminalPlace } from '../contract/service/subjectPolicy.js';

export type CommandSubjectRequest =
  | { readonly _tag: 'Observe'; readonly execution: ExecutionRef }
  | { readonly _tag: 'Await'; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'Launch';
      readonly operation: HostRequestKey;
      readonly program: string;
      readonly args: readonly string[];
      readonly owner: CommandSubject;
    }
  | { readonly _tag: 'Stop'; readonly execution: ExecutionRef }
  | {
      readonly _tag: 'Revise';
      readonly execution: ExecutionRef;
      readonly expected: CommandRevision;
      readonly direction: 'shorten' | 'extend' | 'remaining';
      readonly changeMs: number;
      readonly exceptionCeilingMs?: number;
    };

export type CommandFacts = {
  readonly projectId: number;
  readonly cwd: string;
  readonly environment: EnvironmentBinding;
  readonly roots: readonly string[];
  readonly command: string;
  readonly owner: string;
  readonly scope?: string;
};

export type PreparedCommandSubjects = {
  readonly subjects: readonly PermissionSubject[];
  readonly facts?: CommandFacts;
};

export function commandSubjects(place: TerminalPlace, targetKey: TargetKey, request: CommandSubjectRequest): PreparedCommandSubjects {
  const project = placeProject(place);
  const bound = (kind: PermissionSubject['kind'], value: string, binding: string): PermissionSubject => ({ kind, value, binding });
  const at = (...parts: readonly unknown[]): string => encode([targetKey, ...parts]);
  const subjects: PermissionSubject[] = [];
  let shown: { command: string; owner: string; scope?: string } | undefined;

  switch (request._tag) {
    case 'Observe':
      subjects.push(
        bound('read', `command:read:${project}:${targetKey}:${spell(request.execution)}`, at('read', spell(request.execution))),
      );
      break;
    case 'Await':
      subjects.push(
        bound('read', `command:await:${project}:${targetKey}:${spell(request.execution)}`, at('await', spell(request.execution))),
      );
      break;
    case 'Launch': {
      const command = commandLine(request.program, request.args);
      shown = {
        command,
        owner: ownerShown(request.owner),
        scope: request.owner._tag === 'Service' ? request.owner.scope : undefined,
      };
      const identity = at('launch', request.operation);
      subjects.push(bound('execute', command, identity));
      subjects.push(bound('write', `command:launch:${targetKey}:${request.operation}`, identity));
      break;
    }
    case 'Stop':
      subjects.push(bound('write', `command:stop:${targetKey}:${spell(request.execution)}`, at('stop', spell(request.execution))));
      break;
    case 'Revise': {
      subjects.push(
        bound(
          'write',
          `command:revise:${targetKey}:${spell(request.execution)}:${request.direction}`,
          at('revise', spell(request.execution), request.expected, request.changeMs),
        ),
      );
      if (request.exceptionCeilingMs !== undefined) {
        subjects.push(
          bound(
            'write',
            `command:exception:${targetKey}:${spell(request.execution)}`,
            at('exception', spell(request.execution), request.exceptionCeilingMs),
          ),
        );
      }
      break;
    }
  }
  return {
    subjects,
    facts: place._tag === 'Resolved' && shown !== undefined ? commandFacts(place.target, shown) : undefined,
  };
}

const ownerShown = (owner: CommandSubject): string =>
  owner._tag === 'Thread' ? `thread:${owner.thread}` : owner._tag === 'Operator' ? 'operator' : `service:${owner.scope}`;

const commandFacts = (target: ResolvedExecutionTarget, shown: { command: string; owner: string; scope?: string }): CommandFacts => ({
  projectId: target.projectId,
  cwd: targetCwd(target),
  environment: target.binding,
  roots: target.footprint.roots.map((overlap) => overlap.root.path),
  command: shown.command,
  owner: shown.owner,
  scope: shown.scope,
});
