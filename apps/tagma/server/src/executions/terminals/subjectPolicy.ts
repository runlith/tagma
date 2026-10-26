import type { PermissionSubject } from '@runlith/agent/permissions';
import { BindingId, type Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef, HostRequestKey, Transport } from '@runlith/executions/protocol/execution';
import type { StdinPolicy } from '@runlith/executions/protocol/launch';
import { commandLine } from '../contract/wire/terminals.js';
import { TargetKey, targetCwd, type ResolvedExecutionTarget, type TargetIdentity, type TargetRoot } from '../contract/wire/targets.js';
import type { TerminalLifetime } from '../contract/wire/terminals.js';
import {
  type PreparedTerminalSubjects,
  type TerminalFacts,
  type TerminalPlace,
  type TerminalSubjectRequest,
} from '../contract/service/subjectPolicy.js';

export const encode = (tuple: readonly unknown[]): string => Buffer.from(JSON.stringify(tuple), 'utf8').toString('base64url');

const witnessTuple = (witness: TargetRoot['witness']): readonly string[] => [witness.provider, witness.format, witness.token];

const rootTuple = (root: TargetRoot): readonly unknown[] => [root.rootId, root.locationRevision, ...witnessTuple(root.witness)];

export function targetKeyOf(identity: TargetIdentity): TargetKey {
  return TargetKey.make(
    encode([
      identity.owner,
      identity.projectId,
      identity.actor,
      identity.environmentId,
      identity.namespaceId,
      witnessTuple(identity.environmentWitness),
      witnessTuple(identity.witness),
      identity.cwd,
      [...identity.roots]
        .map(rootTuple)
        .map((tuple) => JSON.stringify(tuple))
        .sort()
        .map((tuple) => JSON.parse(tuple) as readonly unknown[]),
    ]),
  );
}

export function targetIdentity(target: ResolvedExecutionTarget, owner: Principal, actor: Principal): TargetIdentity {
  return {
    owner,
    projectId: target.projectId,
    actor,
    environmentId: target.binding.environmentId,
    namespaceId: target.binding.namespaceId,
    environmentWitness: target.binding.identityWitness,
    witness: target.footprint.witness,
    cwd: targetCwd(target),
    roots: target.footprint.roots.map((overlap) => ({
      rootId: overlap.root.rootId,
      locationRevision: overlap.root.locationRevision,
      witness: overlap.root.witness,
    })),
  };
}

export const placeProject = (place: TerminalPlace): number => (place._tag === 'Keyed' ? place.projectId : place.target.projectId);

export const observationSubjects = (projectId: number, execution: string, incarnation: number): readonly PermissionSubject[] => [
  { kind: 'read', value: `terminal:${projectId}:${execution}/${incarnation}` },
];

export const operationReadSubjects = (projectId: number, operationId: string): readonly PermissionSubject[] => [
  { kind: 'read', value: `terminal:operation:${projectId}:${operationId}` },
];

export const spell = (execution: ExecutionRef): string => `${execution.installation}/${execution.execution}/${execution.incarnation}`;

export const spawnInteractive = (input: {
  readonly actor: Principal;
  readonly operation: HostRequestKey;
  readonly lifetime: TerminalLifetime;
  readonly transport: Transport;
  readonly stdin?: StdinPolicy;
}): { readonly actor: Principal; readonly binding: BindingId } | null =>
  input.lifetime === 'held' && input.transport === 'pipes' && input.stdin === 'pipe'
    ? { actor: input.actor, binding: BindingId.make(`start:${input.operation}`) }
    : null;

export function terminalFacts(
  target: ResolvedExecutionTarget,
  command?: string,
  lifetime?: TerminalLifetime,
  transport?: Transport,
): TerminalFacts {
  return {
    projectId: target.projectId,
    cwd: targetCwd(target),
    environment: target.binding,
    roots: target.footprint.roots.map((overlap) => overlap.root.path),
    command: command,
    lifetime: lifetime,
    transport: transport,
  };
}

export function terminalSubjects(place: TerminalPlace, targetKey: TargetKey, request: TerminalSubjectRequest): PreparedTerminalSubjects {
  const project = placeProject(place);
  const bound = (kind: PermissionSubject['kind'], value: string, binding: string): PermissionSubject => ({ kind, value, binding });
  const at = (...parts: readonly unknown[]): string => encode([targetKey, ...parts]);
  const subjects: PermissionSubject[] = [];

  switch (request._tag) {
    case 'Read':
      subjects.push(bound('read', `terminal:${project}:${targetKey}:${spell(request.execution)}`, at('read', spell(request.execution))));
      break;
    case 'ReadOperation':
      subjects.push(bound('read', `terminal:operation:${project}:${request.operation}`, at('operation', request.operation)));
      break;
    case 'Launch': {
      const command = commandLine(request.program, request.args);
      const identity = at('launch', request.operation);
      subjects.push(bound('execute', command, identity));
      subjects.push(bound('write', `terminal:launch:${targetKey}:${request.operation}:${request.lifetime}`, identity));
      if (request.interactive !== undefined) {
        subjects.push(
          bound(
            'write',
            `terminal:interactive:${targetKey}:${request.operation}:${request.interactive.binding}`,
            at('interactive', request.operation, request.interactive.actor, request.interactive.binding),
          ),
        );
      }
      break;
    }
    case 'Input':
      subjects.push(bound('execute', request.command, at('interpreter', spell(request.execution))));
      subjects.push(
        bound(
          'write',
          request.run === undefined
            ? `terminal:lane:${targetKey}:${spell(request.execution)}:${request.binding}`
            : `terminal:typing:${targetKey}:${spell(request.execution)}:${request.run}`,
          request.run === undefined
            ? at('lane', spell(request.execution), request.actor, request.binding)
            : at('typing', spell(request.execution), request.actor, request.run),
        ),
      );
      break;
    case 'Signal':
      subjects.push(
        bound(
          'write',
          `terminal:signal:${targetKey}:${spell(request.execution)}:${request.revision}:${request.signal}`,
          at('signal', spell(request.execution), request.revision, request.signal),
        ),
      );
      break;
    case 'Stop':
      subjects.push(
        bound(
          'write',
          `terminal:stop:${targetKey}:${spell(request.execution)}:${request.revision}`,
          at('stop', spell(request.execution), request.revision),
        ),
      );
      break;
    case 'Transfer':
      subjects.push(
        bound(
          'write',
          `terminal:transfer:${targetKey}:${spell(request.execution)}:${request.revision}:${request.destination}`,
          at('transfer', spell(request.execution), request.revision, request.destination),
        ),
      );
      break;
  }

  return { subjects };
}
