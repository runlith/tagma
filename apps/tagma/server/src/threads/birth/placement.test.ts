import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { CoveredRepositories } from '../../workspace/contract/service/repositories.js';
import { RepositoryId } from '../../workspace/contract/wire/repositories.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { NewBranches } from '../../worktrees/contract/service/branches.js';
import { WorktreeIntents } from '../../worktrees/contract/service/intents.js';
import { Worktrees } from '../../worktrees/contract/service/creation.js';
import { WorktreeRevision, type WorktreeIntent } from '../../worktrees/contract/wire/creation.js';
import { Settings } from '../../settings/contract/service/values.js';
import { placementDoubles } from '../testing/doubles.js';
import { makePlacementCoordinator } from './placement.js';

const placementOver = (status: 'failed' | 'uncertain', message: string) => {
  const namespaceId = NamespaceId.make('placement-test');
  const repository = { repositoryId: RepositoryId.make('repo'), locationRevision: LocationRevision.make(0) };
  const operation: WorktreeIntent = {
    projectId: 1,
    operationId: RequestKey.make('worktree-test'),
    namespaceId,
    repository,
    destination: '/repo/reviewer',
    mode: { kind: 'new-branch', branch: 'tagma/reviewer', start: 'main' },
    base: 'abc123def',
    payloadDigest: 'placement-test',
    status,
    reserved: false,
    producer: null,
    rootId: null,
    abandonment: null,
    revision: WorktreeRevision.make(0),
    evidence: {
      command: ['git', 'worktree', 'add'],
      ended: status === 'failed' ? 'exit' : 'lost',
      status: status === 'failed' ? 1 : null,
      message,
      overflow: false,
      unproven: status === 'uncertain' ? message : null,
      destination: status === 'failed' ? 'absent' : 'present',
      retained: null,
    },
  };
  return Layer.mergeAll(
    Layer.mock(WorktreeIntents, { byId: () => Effect.succeed(null) }),
    Layer.mock(Coverage, {
      onCovered: () => {
        throw new Error('Coverage.onCovered');
      },
      recorded: () => {
        throw new Error('Coverage.recorded');
      },
      covered: () => Effect.succeed({ projectId: 1, namespaceId, rootPath: '/repo', roots: [], withheld: [] }),
    }),
    Layer.mock(CoveredRepositories, {
      at: () =>
        Effect.succeed({
          repositories: [
            {
              binding: repository,
              commonDirectory: '/repo/.git',
              bare: false,
              head: { ref: 'refs/heads/main', commit: 'abc123def' },
              checkouts: ['/repo'],
            },
          ],
          withheld: [],
        }),
    }),
    Layer.mock(Worktrees, {
      onRecorded: () => {
        throw new Error('Worktrees.onRecorded');
      },
      prepare: () =>
        Effect.succeed({
          subjects: {
            namespaceId,
            repository,
            destination: { namespaceId, path: operation.destination },
            ref: 'refs/heads/tagma/reviewer',
          },
          operation,
        }),
      create: () => Effect.succeed(operation),
    }),
    Layer.mock(NewBranches, { generated: (_path, prefix, name) => Effect.succeed(`${prefix}${name}`) }),
    Layer.mock(Settings, { value: (key) => Effect.succeed(key.fallback) }),
  );
};

const ask = {
  projectId: 1,
  worktree: 'new',
  from: null,
  operationId: 'spawn:call-1',
  name: 'reviewer',
  base: 'abc123def',
  agent: false,
  asked: false,
  guest: false,
} as const;

const names = (lines: readonly string[], operation: string): boolean => lines.some((line) => line.includes(operation));

layer(placementDoubles)('placement refusal recovery', (it) => {
  it.effect('a creation that failed names only the operation read: abandon and recovery refuse a settled creation', () =>
    Effect.gen(function* () {
      const doubles = yield* Layer.build(
        placementOver('failed', "fatal: 'refs/heads/tagma' exists; cannot create 'refs/heads/tagma/reviewer-048411'"),
      );
      const placement = yield* Effect.provide(makePlacementCoordinator, doubles);
      const refused = yield* Effect.flip(placement.resolve(ask));
      expect(refused.code).toBe('worktree-unresolved');
      expect(names(refused.unblock, 'read_worktree_operation')).toBe(true);
      expect(names(refused.unblock, 'abandon_worktree')).toBe(false);
      expect(names(refused.unblock, 'adopt_worktree')).toBe(false);
      expect(names(refused.unblock, 'prepare_worktree_recovery')).toBe(false);
    }),
  );

  it.effect('a creation left uncertain names the recovery and the release beside the operation read', () =>
    Effect.gen(function* () {
      const doubles = yield* Layer.build(placementOver('uncertain', 'the checkout stands but the branch it stands on could not be proven'));
      const placement = yield* Effect.provide(makePlacementCoordinator, doubles);
      const refused = yield* Effect.flip(placement.resolve(ask));
      expect(refused.code).toBe('worktree-unresolved');
      expect(names(refused.unblock, 'read_worktree_operation')).toBe(true);
      expect(names(refused.unblock, 'abandon_worktree')).toBe(true);
      expect(names(refused.unblock, 'adopt_worktree')).toBe(true);
      expect(names(refused.unblock, 'prepare_worktree_recovery')).toBe(true);
    }),
  );
});
