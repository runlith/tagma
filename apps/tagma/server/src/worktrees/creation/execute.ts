import type { RequestKey } from '../../platform/contract/wire/ids.js';
import { createHash } from 'node:crypto';
import { Effect, Result } from 'effect';
import { addWorktree, worktreeCommand, worktreesOf } from '@runlith/git/worktree';
import { troubleOf } from '@runlith/git/repository';
import { ancestorAt } from '@runlith/git/history';
import { changedBetween } from '@runlith/git/entries';
import { inGraphTree } from '../../graph/contract/wire/storage.js';
import { GraphDelivering } from '../contract/service/retirement.js';
import { Git } from '@runlith/git/Git';
import { canonicalJson } from '@runlith/utils/object';
import type { AcquiredEnvironment } from '../../workspace/contract/service/environments.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { worktreeOperation } from '../store/tables.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { Repositories } from '../../workspace/contract/service/repositories.js';
import {
  startOf,
  WorktreeRevision,
  type WorktreeIntent,
  type WorktreePreparation,
  type WorktreeRequest,
} from '../contract/wire/creation.js';
import { WorktreeRefused, WorktreeUnavailable, type WorktreeFailure } from '../contract/wire/failures.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import { storageUnavailable } from '../store/registry.js';
import { makeDestinationChecks } from './checks.js';
import { type CreationRecovery, makeCreationRecovery } from './recovery.js';
import { endedOf, makeCreationPublication, planOf, subjectsOf, type CreationFailure } from './publication.js';
import type { PrepareCreationInput, WorktreeExecution } from './requests.js';

const digestOf = (intent: WorktreeRequest): string => createHash('sha256').update(canonicalJson(intent)).digest('hex');

const failureOf = (error: CreationFailure, operationId?: RequestKey): WorktreeFailure => {
  switch (error._tag) {
    case 'WorktreeRefused':
    case 'WorktreeMissing':
    case 'WorktreeUnavailable':
    case 'RepositoryMissing':
    case 'RepositoryUnavailable':
    case 'RepositoryConflict':
    case 'RepositoryBaseMissing':
    case 'RepositoryInvalid':
    case 'RepositoryUnreadable':
    case 'RepositoryRefused':
    case 'RootMissing':
    case 'RootUnavailable':
    case 'RootInvalid':
    case 'RootConflict':
    case 'RootRefused':
      return error;
    default:
      return storageUnavailable(error, operationId);
  }
};

const taken = (operationId: RequestKey): Effect.Effect<never, WorktreeRefused> =>
  Effect.fail(
    new WorktreeRefused({
      operationId,
      reason: 'changed-payload',
      message: 'This name already stands for a different creation; a second act takes a name of its own.',
    }),
  );

export type WorktreeCreator = CreationRecovery & {
  readonly onRecorded: (listener: (projectId: number, rootId: RootId) => void) => () => void;
  readonly prepare: (request: PrepareCreationInput) => Effect.Effect<WorktreePreparation, WorktreeFailure>;
  readonly execute: (request: WorktreeExecution) => Effect.Effect<WorktreeIntent, WorktreeFailure>;
};

export const makeWorktreeCreator = Effect.gen(function* () {
  const intents = yield* WorktreeIntents;
  const repositories = yield* Repositories;
  const roots = yield* FileRoots;
  const git = yield* Git;
  const units = yield* MachineUnits;
  const checks = yield* makeDestinationChecks;
  const publication = yield* makeCreationPublication({ checks });
  const graph = yield* GraphDelivering;

  const graphBase = Effect.fn('WorktreeCreator.graphBase')(
    function* (opened: WorktreeIntent, common: string, headRef: string | null) {
      if (opened.mode.kind === 'existing-branch') return { base: opened.base, left: undefined };
      const start = startOf(opened.mode);
      const ref = start === 'HEAD' ? headRef : start.startsWith('refs/heads/') ? start : `refs/heads/${start}`;
      const rows = yield* worktreesOf(git, common);
      const main = rows[0]?.head?.commit === opened.base ? rows[0] : undefined;
      const checkout = rows.find((row) => row.head?.ref === ref) ?? main;
      if (checkout === undefined) return { base: opened.base, left: undefined };
      const synced = yield* graph.sync(opened.projectId, checkout.path);
      if (synced === 'ordinary') return { base: opened.base, left: undefined };
      const head = synced.head;
      if (synced.policy === 'off' || head === null) return { base: opened.base, left: synced.left };
      const follows = yield* ancestorAt(git, common, opened.base, head);
      const unchanged = follows && !(yield* changedBetween(git, common, opened.base, head)).some((path) => !inGraphTree(path));
      return { base: unchanged ? head : opened.base, left: synced.left };
    },
    (work, opened) =>
      Effect.mapError(
        work,
        (failure) =>
          new WorktreeUnavailable({
            operationId: opened.operationId,
            reason: 'git',
            message: failure.message,
          }),
      ),
  );

  const admitted = Effect.fn('WorktreeCreator.admitted')(function* (
    operationId: RequestKey,
    acquired: AcquiredEnvironment,
  ): Effect.fn.Return<void, WorktreeRefused> {
    const binding = acquired.binding;
    if (binding.kind !== 'host') {
      return yield* new WorktreeRefused({
        operationId,
        reason: 'foreign-environment',
        message: `This creation runs on the host, and the acquired environment is a ${binding.kind}.`,
      });
    }
    if (binding.namespaceId !== roots.namespaceId) {
      return yield* new WorktreeRefused({
        operationId,
        reason: 'foreign-namespace',
        message: `The acquired environment resolves paths in ${binding.namespaceId}; these roots are registered in ${roots.namespaceId}.`,
      });
    }
  });

  const recovery = yield* makeCreationRecovery({ checks, publication, admitted, failure: failureOf });

  const ceased = Effect.fn('WorktreeCreator.ceased')(function* (
    authorized: WorktreeIntent,
    command: readonly string[],
  ): Effect.fn.Return<WorktreeIntent, CreationFailure> {
    return yield* publication.settle(
      {
        ...authorized,
        status: 'uncertain',
        evidence: endedOf(
          command,
          'terminated',
          'This installation closed the scope around git and ended the run.',
          yield* checks.stands(authorized.destination),
          null,
        ),
      },
      authorized.revision,
    );
  });

  return {
    ...recovery,
    onRecorded: publication.onRecorded,
    prepare: Effect.fn('WorktreeCreator.prepare')(
      function* (request: PrepareCreationInput): Effect.fn.Return<WorktreePreparation, CreationFailure> {
        const { intent, acquired } = request;
        const operationId = intent.operationId;
        yield* admitted(operationId, acquired);
        const digest = digestOf(intent);
        const already = yield* units.read((unit) => intents.byId(operationId, unit));
        if (already !== null) {
          if (already.payloadDigest !== digest) return yield* taken(operationId);
          return { subjects: subjectsOf(already), operation: already };
        }
        const destination = yield* checks.place(operationId, intent.destination);
        const resolved: WorktreeRequest = { ...intent, destination };
        const standing = yield* repositories.read(intent.repository.repositoryId, intent.repository.locationRevision);
        yield* checks.ref(operationId, standing, intent);
        const base = yield* checks.commit(standing.repository.commonDirectory, startOf(intent.mode));
        if (base === null) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'base-absent',
            message: `${standing.repository.commonDirectory} resolves ${startOf(intent.mode)} to no commit, so there is nothing to check out.`,
          });
        }
        yield* checks.vacant(operationId, destination);
        const opened: WorktreeIntent = {
          ...resolved,
          namespaceId: roots.namespaceId,
          base,
          payloadDigest: digest,
          status: 'pending',
          reserved: false,
          producer: null,
          rootId: null,
          evidence: null,
          abandonment: null,
          revision: WorktreeRevision.make(0),
        };
        const operation = yield* units.write(writes('Worktrees.operation', [worktreeOperation]), (unit) =>
          Effect.gen(function* () {
            const landed = yield* intents.byId(operationId, unit);
            if (landed === null) return yield* intents.insert(opened, unit);
            return landed.payloadDigest === opened.payloadDigest ? landed : yield* taken(operationId);
          }),
        );
        return { subjects: subjectsOf(operation), operation };
      },
      (work, request) => Effect.mapError(work, (error) => failureOf(error, request.intent.operationId)),
    ),
    execute: Effect.fn('WorktreeCreator.execute')(
      function* (request: WorktreeExecution): Effect.fn.Return<WorktreeIntent, CreationFailure> {
        const { operationId, acquired } = request;
        yield* admitted(operationId, acquired);
        const opened = yield* recovery.read(operationId, request.projectId);
        if (opened.status !== 'pending' || opened.reserved) return opened;
        const standing = yield* repositories.read(opened.repository.repositoryId, opened.repository.locationRevision);
        const common = standing.repository.commonDirectory;
        if ((yield* checks.commit(common, opened.base)) === null) {
          return yield* new WorktreeRefused({
            operationId,
            reason: 'base-absent',
            message: `${common} no longer holds ${opened.base}, which this creation was prepared to stand on.`,
          });
        }
        const vacancy = yield* Effect.result(checks.free(opened, standing));
        const current = Result.isFailure(vacancy) ? yield* recovery.read(operationId, request.projectId) : opened;
        if (current.status !== 'pending' || current.reserved) return current;
        if (Result.isFailure(vacancy)) return yield* vacancy.failure;
        const inherited = yield* graphBase(opened, common, standing.head.ref);
        const outcome = yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const reserved = yield* publication.reserve(opened, inherited.base);
            if (!reserved.taken) return { authorized: reserved.operation, ran: null };
            const authorized = reserved.operation;
            const plan = planOf(authorized);
            const ran = yield* restore(Effect.result(addWorktree(git, common, plan))).pipe(
              Effect.onInterrupt(() =>
                ceased(authorized, worktreeCommand(common, plan)).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning('an interrupted creation could not record that this server ended it', { operationId, cause }),
                  ),
                ),
              ),
            );
            return { authorized, ran };
          }),
        );
        if (outcome.ran === null) return outcome.authorized;
        const { authorized, ran } = { authorized: outcome.authorized, ran: outcome.ran };
        if (Result.isFailure(ran)) {
          if (ran.failure._tag !== 'GitUnavailable') {
            const seen = yield* checks.stands(authorized.destination);
            return yield* publication.settle(
              {
                ...authorized,
                status: 'uncertain',
                evidence: endedOf(ran.failure.command, 'lost', troubleOf(ran.failure), seen, yield* checks.retained(authorized, common)),
              },
              authorized.revision,
            );
          }
          return yield* publication.settle(
            {
              ...authorized,
              status: 'failed',
              evidence: endedOf(ran.failure.command, 'unstarted', ran.failure.reason, yield* checks.stands(authorized.destination), null),
            },
            authorized.revision,
          );
        }
        const creation = ran.success;
        const stands = yield* checks.stands(authorized.destination);
        if (creation.status !== 0) {
          return yield* publication.unwritten(authorized, creation, stands, yield* checks.retained(authorized, common), inherited.left);
        }
        return yield* publication.registered(authorized, standing, creation, stands, inherited.left);
      },
      (work, request) => Effect.mapError(work, (error) => failureOf(error, request.operationId)),
    ),
  } satisfies WorktreeCreator;
});
