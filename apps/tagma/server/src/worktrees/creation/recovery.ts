import type { RequestKey } from '../../platform/contract/wire/ids.js';
import { Effect } from 'effect';
import { sameWitness } from '@runlith/files/witness';
import { worktreeCommand } from '@runlith/git/worktree';
import type { AcquiredEnvironment } from '../../workspace/contract/service/environments.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { Repositories } from '../../workspace/contract/service/repositories.js';
import type { WorktreeIntent, WorktreeRecoveryPreparation } from '../contract/wire/creation.js';
import { WorktreeMissing, WorktreeRefused, type WorktreeFailure } from '../contract/wire/failures.js';
import type { DestinationChecks } from './checks.js';
import { type CreationPublication, endedOf, planOf, subjectsOf, type CreationFailure } from './publication.js';
import type { WorktreeAdoption, WorktreeAbandonment, WorktreeExecution, WorktreeRecoveryRequest } from './requests.js';
import { WorktreeIntents } from '../contract/service/intents.js';

export type CreationRecovery = {
  readonly read: (operationId: RequestKey, projectId: number) => Effect.Effect<WorktreeIntent, WorktreeFailure>;
  readonly prepareRecovery: (request: WorktreeRecoveryRequest) => Effect.Effect<WorktreeRecoveryPreparation, WorktreeFailure>;
  readonly adopt: (request: WorktreeAdoption) => Effect.Effect<WorktreeIntent, WorktreeFailure>;
  readonly abandon: (request: WorktreeAbandonment) => Effect.Effect<WorktreeIntent, WorktreeFailure>;
  readonly reconcile: (request: WorktreeExecution) => Effect.Effect<WorktreeIntent, WorktreeFailure>;
};

export const makeCreationRecovery = Effect.fnUntraced(function* (input: {
  readonly checks: DestinationChecks;
  readonly publication: CreationPublication;
  readonly admitted: (operationId: RequestKey, acquired: AcquiredEnvironment) => Effect.Effect<void, WorktreeRefused>;
  readonly failure: (error: CreationFailure, operationId?: RequestKey) => WorktreeFailure;
}) {
  const { checks, publication, admitted, failure } = input;
  const intents = yield* WorktreeIntents;
  const repositories = yield* Repositories;
  const roots = yield* FileRoots;
  const units = yield* MachineUnits;

  const recoverable = Effect.fn('WorktreeCreator.recoverable')(function* (
    opened: WorktreeIntent,
  ): Effect.fn.Return<WorktreeIntent, WorktreeRefused> {
    if (opened.abandonment !== null) {
      return yield* new WorktreeRefused({
        operationId: opened.operationId,
        reason: 'abandoned',
        message: `This creation was declared finished with: ${opened.abandonment}`,
      });
    }
    if (opened.status === 'failed' || opened.status === 'ready') {
      return yield* new WorktreeRefused({
        operationId: opened.operationId,
        reason: 'settled',
        message: `This creation resolved as ${opened.status}, so there is no checkout of it to take.`,
      });
    }
    if (!opened.reserved) {
      return yield* new WorktreeRefused({
        operationId: opened.operationId,
        reason: 'unreserved',
        message: 'This creation was never authorized, so no checkout of it can be attributed to it.',
      });
    }
    return opened;
  });

  const scoped = Effect.fn('WorktreeCreator.scoped')(function* (
    operation: WorktreeIntent,
    projectId: number,
  ): Effect.fn.Return<WorktreeIntent, WorktreeRefused> {
    if (operation.projectId === projectId) return operation;
    return yield* new WorktreeRefused({
      operationId: operation.operationId,
      reason: 'foreign-project',
      message: `This creation was prepared for project ${operation.projectId}, and this call is authenticated for ${projectId}.`,
    });
  });

  const read = Effect.fn('WorktreeCreator.read')(
    function* (operationId: RequestKey, projectId: number): Effect.fn.Return<WorktreeIntent, CreationFailure> {
      const row = yield* units.read((unit) => intents.byId(operationId, unit));
      if (row === null) {
        return yield* new WorktreeMissing({
          operationId,
          message: 'No creation stands under that name in this installation.',
        });
      }
      return yield* scoped(row, projectId);
    },
    (work, operationId) => Effect.mapError(work, (error) => failure(error, operationId)),
  );

  return {
    read,
    prepareRecovery: Effect.fn('WorktreeCreator.prepareRecovery')(
      function* (request: WorktreeRecoveryRequest): Effect.fn.Return<WorktreeRecoveryPreparation, CreationFailure> {
        const { operationId, acquired } = request;
        yield* admitted(operationId, acquired);
        const opened = yield* recoverable(yield* read(operationId, request.projectId));
        const standing = yield* repositories.read(opened.repository.repositoryId, opened.repository.locationRevision);
        return {
          subjects: subjectsOf(opened),
          observed: yield* checks.observed(opened, standing, request.observed),
          operation: opened,
        };
      },
      (work, request) => Effect.mapError(work, (error) => failure(error, request.operationId)),
    ),
    adopt: Effect.fn('WorktreeCreator.adopt')(
      function* (request: WorktreeAdoption): Effect.fn.Return<WorktreeIntent, CreationFailure> {
        const { recovery, acquired } = request;
        const operationId = recovery.operationId;
        yield* admitted(operationId, acquired);
        const stood = yield* read(operationId, recovery.projectId);
        if (stood.status === 'ready') return stood;
        const opened = yield* recoverable(stood);
        if (opened.revision !== recovery.revision) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'stale-revision',
            message: `This creation stands at revision ${opened.revision}, and the recovery was decided at ${recovery.revision}.`,
          });
        }
        const standing = yield* repositories.read(opened.repository.repositoryId, opened.repository.locationRevision);
        const observed = yield* checks.observed(opened, standing, recovery.observed.path);
        if (!sameWitness(observed.witness, recovery.observed.witness) || observed.gitDirectory !== recovery.observed.gitDirectory) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'observed-changed',
            message: `${observed.path} does not hold the checkout this recovery was approved over.`,
          });
        }
        const adoption = yield* roots.resolve({
          path: observed.path,
          provenance: { kind: 'worktree-recovered', id: operationId },
          git: {
            repositoryId: standing.repository.repositoryId,
            gitDirectory: { namespaceId: roots.namespaceId, path: observed.gitDirectory },
          },
        });
        yield* publication.unchanged(opened, adoption, observed);
        const draft = yield* publication.drafted(opened, standing, observed.path);
        return yield* publication.published({ ...opened, status: 'ready' }, opened.revision, adoption, draft);
      },
      (work, request) => Effect.mapError(work, (error) => failure(error, request.recovery.operationId)),
    ),
    abandon: Effect.fn('WorktreeCreator.abandon')(
      function* (request: WorktreeAbandonment): Effect.fn.Return<WorktreeIntent, CreationFailure> {
        const { operationId, acquired } = request;
        yield* admitted(operationId, acquired);
        const opened = yield* read(operationId, request.projectId);
        if (opened.abandonment !== null) return opened;
        if (opened.evidence === null) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'unreconciled',
            message: 'Nothing here saw this creation end, so nothing here may declare that it cannot still be writing.',
          });
        }
        if (opened.status !== 'uncertain') {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'settled',
            message: `This creation resolved as ${opened.status} and holds nothing to release.`,
          });
        }
        if (opened.revision !== request.revision) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'stale-revision',
            message: `This creation stands at revision ${opened.revision}, and the abandonment was decided at ${request.revision}.`,
          });
        }
        return yield* publication.settle({ ...opened, abandonment: request.reason }, opened.revision);
      },
      (work, request) => Effect.mapError(work, (error) => failure(error, request.operationId)),
    ),
    reconcile: Effect.fn('WorktreeCreator.reconcile')(
      function* (request: WorktreeExecution): Effect.fn.Return<WorktreeIntent, CreationFailure> {
        const { operationId, acquired } = request;
        yield* admitted(operationId, acquired);
        const opened = yield* read(operationId, request.projectId);
        if (opened.evidence !== null || opened.abandonment !== null) return opened;
        if (opened.status !== 'pending' || !opened.reserved) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'settled',
            message: `This creation stands at ${opened.status} with no authorized run to reconcile.`,
          });
        }
        if (opened.producer === publication.producer) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'unreconciled',
            message: 'This installation authorized that run itself, so nothing here may declare it over.',
          });
        }
        const standing = yield* repositories.read(opened.repository.repositoryId, opened.repository.locationRevision);
        return yield* publication.settle(
          {
            ...opened,
            status: 'uncertain',
            evidence: endedOf(
              worktreeCommand(standing.repository.commonDirectory, planOf(opened)),
              'lost',
              opened.producer === null
                ? 'This run was authorized by a build that recorded no producer, which is not this one.'
                : `The installation that authorized this run, ${opened.producer}, is not the one reading it.`,
              yield* checks.stands(opened.destination),
              yield* checks.retained(opened, standing.repository.commonDirectory),
            ),
          },
          opened.revision,
        );
      },
      (work, request) => Effect.mapError(work, (error) => failure(error, request.operationId)),
    ),
  } satisfies CreationRecovery;
});
