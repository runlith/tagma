import { expect, test } from 'bun:test';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { EnvironmentId } from '../../../workspace/contract/wire/environments.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import { placeOf, type AdmittedExecutionTarget } from './targets.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootOverlap } from '../../../workspace/contract/wire/roots.js';

const namespaceId = NamespaceId.make('namespace-1');
const witness = (token: string) => ({ provider: 'test', format: 'test', token });

const overlap = (rootId: string, path: string, relation: RootOverlap['relation']): RootOverlap => ({
  root: {
    rootId: RootId.make(rootId),
    namespaceId,
    path,
    locationRevision: LocationRevision.make(0),
    witness: witness(rootId),
    provenance: { kind: 'project', id: '7' },
    git: null,
    state: 'active',
  },
  resource: { namespaceId, path },
  relation,
});

const covered = (rootId: string, path: string, origin: ProjectRoot['origin']): ProjectRoot => ({
  projectId: 7,
  rootId: RootId.make(rootId),
  path,
  origin,
});

const PROJECT = [covered('main', '/repo', 'canonical'), covered('tree', '/repo/.worktrees/one', 'worktree')];

const admitted = (cwd: string, roots: readonly RootOverlap[], named?: string): AdmittedExecutionTarget => {
  const footprint = {
    status: 'complete' as const,
    resource: { namespaceId, path: cwd },
    witness: witness(cwd),
    registryRevision: 1,
    roots,
  };
  return {
    target: {
      projectId: 7,
      binding: { environmentId: EnvironmentId.make('host'), kind: 'host', namespaceId, identityWitness: witness('host') },
      footprint,
      named: named === undefined ? undefined : { rootId: RootId.make(named), locationRevision: LocationRevision.make(0) },
    },
    admission: {
      coverage: { projectId: 7, namespaceId, rootPath: '/repo', roots: PROJECT, withheld: [] },
      covered: PROJECT.filter((root) => roots.some((one) => one.root.rootId === root.rootId)),
      footprint,
    },
  };
};

test('a start inside a worktree is placed at the worktree, not at main that holds its folder', () => {
  expect(
    placeOf(
      admitted('/repo/.worktrees/one/src', [overlap('main', '/repo', 'ancestor'), overlap('tree', '/repo/.worktrees/one', 'ancestor')]),
    ),
  ).toBe(RootId.make('tree'));
});

test('a start in main is placed at main, though a worktree lies inside its folder', () => {
  expect(placeOf(admitted('/repo', [overlap('main', '/repo', 'equal'), overlap('tree', '/repo/.worktrees/one', 'descendant')]))).toBe(
    RootId.make('main'),
  );
});

test('a root of another project nearer the folder does not place the start', () => {
  expect(placeOf(admitted('/repo/apps/web', [overlap('main', '/repo', 'ancestor'), overlap('elsewhere', '/repo/apps/web', 'equal')]))).toBe(
    RootId.make('main'),
  );
});

test('a start on no root of the project is unplaced', () => {
  expect(placeOf(admitted('/tmp/scratch', []))).toBeUndefined();
});

test('a named root holding the folder places the start', () => {
  expect(
    placeOf(
      admitted('/repo/.worktrees/one', [overlap('main', '/repo', 'ancestor'), overlap('tree', '/repo/.worktrees/one', 'equal')], 'main'),
    ),
  ).toBe(RootId.make('main'));
});

test('a named root of another project does not place the start', () => {
  expect(
    placeOf(
      admitted('/repo/apps/web', [overlap('main', '/repo', 'ancestor'), overlap('elsewhere', '/repo/apps/web', 'equal')], 'elsewhere'),
    ),
  ).toBe(RootId.make('main'));
});
