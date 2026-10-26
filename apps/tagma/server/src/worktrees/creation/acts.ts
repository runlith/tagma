import { RequestKey } from '../../platform/contract/wire/ids.js';
import { Effect, type Scope } from 'effect';
import type { EnvironmentConsumer } from '../../workspace/contract/wire/environments.js';
import { RepositoryMissing, type RepositoryId } from '../../workspace/contract/wire/repositories.js';
import type { WorktreeFailure } from '../contract/wire/failures.js';
import { type AcquiredEnvironment, Environments } from '../../workspace/contract/service/environments.js';
import { CoveredRepositories } from '../../workspace/contract/service/repositories.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import {
  WorktreeHostUnreadable,
  type WorktreeActFailure,
  type WorktreeCaller,
  type WorktreeCreationRequest,
  type WorktreeFolder,
  Worktrees,
} from '../contract/service/creation.js';
import type { WorktreeCreator } from './execute.js';

const folderName = (request: WorktreeCreationRequest): string =>
  request.mode.kind === 'detached' ? request.operationId : request.mode.branch.replaceAll('/', '-');

const REQUIRES = ['files', 'exec'] as const;

export const makeCreationDriver = Effect.fnUntraced(function* (input: {
  readonly worktrees: WorktreeCreator;
  readonly folder: WorktreeFolder;
}) {
  const { worktrees, folder } = input;
  const environments = yield* Environments;
  const stores = yield* CoveredRepositories;
  const roots = yield* FileRoots;

  const acquired = Effect.fn('Worktrees.acquired')(function* (
    consumer: EnvironmentConsumer,
  ): Effect.fn.Return<AcquiredEnvironment, WorktreeActFailure, Scope.Scope> {
    const state = yield* environments.inspect('host');
    if (state.binding === null) {
      return yield* new WorktreeHostUnreadable({
        message: state.reason ?? 'The host environment of this installation answered for no identity, so nothing can be acquired over it.',
      });
    }
    return yield* environments.acquireActive({ binding: state.binding, consumer, requires: REQUIRES });
  });

  const inEnvironment = Effect.fn('Worktrees.inEnvironment')(function* <A>(
    operationId: RequestKey,
    act: (acquired: AcquiredEnvironment) => Effect.Effect<A, WorktreeFailure>,
  ): Effect.fn.Return<A, WorktreeActFailure> {
    return yield* Effect.scoped(Effect.flatMap(acquired({ kind: 'worktree', id: operationId }), act));
  });

  const covered = Effect.fn('Worktrees.covered')(function* (caller: WorktreeCaller, repositoryId: RepositoryId) {
    if (!(yield* stores.covers(caller.projectId, repositoryId))) {
      return yield* new RepositoryMissing({
        namespaceId: roots.namespaceId,
        repositoryId,
        message: 'No store this project covers answers to that identity.',
      });
    }
  });

  const read = Effect.fn('Worktrees.read')((caller: WorktreeCaller, operationId: RequestKey) =>
    worktrees.read(operationId, caller.projectId),
  );

  return Worktrees.of({
    onRecorded: worktrees.onRecorded,
    prepare: Effect.fn('Worktrees.prepare')(function* (caller, request) {
      yield* covered(caller, request.repository.repositoryId);
      const destination =
        request.destination === undefined ? `${yield* folder(caller.projectId)}/${folderName(request)}` : request.destination;
      return yield* inEnvironment(request.operationId, (acquired) =>
        worktrees.prepare({
          intent: {
            operationId: request.operationId,
            repository: request.repository,
            destination,
            mode: request.mode,
            projectId: caller.projectId,
          },
          acquired,
        }),
      );
    }),
    create: Effect.fn('Worktrees.create')(function* (caller, operationId) {
      const opened = yield* read(caller, operationId);
      yield* covered(caller, opened.repository.repositoryId);
      return yield* inEnvironment(operationId, (acquired) => worktrees.execute({ operationId, projectId: caller.projectId, acquired }));
    }),
    reconcile: Effect.fn('Worktrees.reconcile')(function* (caller, operationId) {
      const opened = yield* read(caller, operationId);
      yield* covered(caller, opened.repository.repositoryId);
      return yield* inEnvironment(operationId, (acquired) => worktrees.reconcile({ operationId, projectId: caller.projectId, acquired }));
    }),
    read,
    prepareRecovery: Effect.fn('Worktrees.prepareRecovery')((caller, operationId, observed) =>
      inEnvironment(operationId, (acquired) => worktrees.prepareRecovery({ operationId, projectId: caller.projectId, observed, acquired })),
    ),
    adopt: Effect.fn('Worktrees.adopt')((caller, operationId, revision, observed) =>
      inEnvironment(operationId, (acquired) =>
        worktrees.adopt({ recovery: { operationId, projectId: caller.projectId, revision, observed }, acquired }),
      ),
    ),
    abandon: Effect.fn('Worktrees.abandon')((caller, operationId, revision, reason) =>
      inEnvironment(operationId, (acquired) => worktrees.abandon({ operationId, projectId: caller.projectId, revision, reason, acquired })),
    ),
  });
});
