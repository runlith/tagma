import { describe, expect, test } from 'bun:test';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, type ExecutionRef, InstallationId, HostRequestKey } from '@runlith/executions/protocol/execution';
import { NamespaceId, type IdentityWitness } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { EnvironmentId } from '../../workspace/contract/wire/environments.js';
import { TargetKey, type ResolvedExecutionTarget } from '../contract/wire/targets.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { spawnInteractive, terminalSubjects } from './subjectPolicy.js';
import { type TerminalSubjectRequest } from '../contract/service/subjectPolicy.js';

const witnessed = (token: string): IdentityWitness => ({ provider: 'test', format: 'test', token });

const targetAt = (path: string, rootId: string): ResolvedExecutionTarget => {
  const namespaceId = NamespaceId.make('namespace-1');
  const resource = { namespaceId, path };
  return {
    projectId: 7,
    binding: {
      environmentId: EnvironmentId.make(`environment-${rootId}`),
      kind: 'host',
      namespaceId,
      identityWitness: witnessed(`environment-${rootId}`),
    },
    footprint: {
      status: 'complete',
      resource,
      witness: witnessed(`resource-${path}`),
      registryRevision: 3,
      roots: [
        {
          root: {
            rootId: RootId.make(rootId),
            namespaceId,
            path,
            locationRevision: LocationRevision.make(0),
            witness: witnessed(`root-${rootId}`),
            provenance: { kind: 'test', id: rootId },
            git: null,
            state: 'active',
          },
          resource,
          relation: 'equal',
        },
      ],
    },
  };
};

describe('spawnInteractive', () => {
  const actor = Principal.make('thread:thread-1');
  const operation = HostRequestKey.make('op-1');

  test('a held piped start with a declared writer names its proposed binding', () => {
    const marked = spawnInteractive({ actor, operation, lifetime: 'held', transport: 'pipes', stdin: 'pipe' });
    expect(marked).toEqual({
      actor,
      binding: expect.anything(),
    });
    expect(String(marked?.binding)).toContain('op-1');
  });

  test('anything else launches bare', () => {
    expect(spawnInteractive({ actor, operation, lifetime: 'call', transport: 'pipes', stdin: 'pipe' })).toBeNull();
    expect(spawnInteractive({ actor, operation, lifetime: 'held', transport: 'pty' })).toBeNull();
    expect(spawnInteractive({ actor, operation, lifetime: 'held', transport: 'pipes', stdin: 'ignore' })).toBeNull();
    expect(spawnInteractive({ actor, operation, lifetime: 'held', transport: 'pipes', stdin: 'inherit' })).toBeNull();
    expect(spawnInteractive({ actor, operation, lifetime: 'held', transport: 'pipes' })).toBeNull();
  });
});
describe('the place an act stands on', () => {
  const key = TargetKey.make('target-key-1');
  const execution: ExecutionRef = {
    installation: InstallationId.make('install-1'),
    execution: ExecutionId.make('exec-1'),
    incarnation: 2,
  };
  const actor = Principal.make('thread:thread-1');
  const binding = BindingId.make('binding-1');
  const PROJECT = 7;

  const standing: readonly TerminalSubjectRequest[] = [
    { _tag: 'Input', execution, actor, binding, command: 'bash -l' },
    { _tag: 'Input', execution, actor, run: 'run-1', command: 'bash -l' },
    { _tag: 'Signal', execution, revision: 3, signal: 'SIGTERM' },
    { _tag: 'Stop', execution, revision: 3 },
    { _tag: 'Read', execution },
  ];

  test('an act over a standing execution declares the same subjects however its place was read', () => {
    for (const request of standing) {
      const keyed = terminalSubjects({ _tag: 'Keyed', projectId: PROJECT, targetKey: key }, key, request);
      const here = terminalSubjects({ _tag: 'Resolved', target: targetAt('/work/one', 'root-1'), targetKey: key }, key, request);
      const elsewhere = terminalSubjects({ _tag: 'Resolved', target: targetAt('/work/two', 'root-2'), targetKey: key }, key, request);
      expect(here.subjects, `${request._tag} over a resolved place`).toEqual(keyed.subjects);
      expect(elsewhere.subjects, `${request._tag} over another resolved place`).toEqual(keyed.subjects);
    }
  });
});
