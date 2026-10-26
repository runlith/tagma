import { Effect, Path, Result } from 'effect';
import { uuidv7 } from 'uuidv7';
import { sameWitness } from '@runlith/files/witness';
import type { WorktreeCreation, WorktreePlan } from '@runlith/git/worktree';
import { commitOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { fileRoot, fileRootNamespace, projectRoot } from '../../workspace/store/tables.js';
import { worktree, worktreeOperation } from '../store/tables.js';
import type { RepositoryState } from '../../workspace/contract/wire/repositories.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { GraphRemainder } from '../../graph/contract/wire/answers.js';
import { FileRoots, type RootAdoption, RootPublished } from '../../workspace/contract/service/roots.js';
import {
  branchOf,
  refOf,
  WorktreeRevision,
  type ObservedCheckout,
  type WorktreeEvidence,
  type WorktreeIntent,
  type WorktreeSubjects,
} from '../contract/wire/creation.js';
import { WorktreeMissing, WorktreeRefused, WorktreeUnavailable, type WorktreeFailure } from '../contract/wire/failures.js';
import { type WorktreeDraft, WorktreeRecords, type WorktreeStoreFailure } from '../contract/service/worktrees.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import type { Destination, DestinationChecks, Retained } from './checks.js';

export type CreationFailure = WorktreeFailure | WorktreeStoreFailure;

type Unrooted = Omit<WorktreeDraft, 'rootId'>;

export const planOf = (operation: WorktreeIntent): WorktreePlan => {
  const mode = operation.mode;
  if (mode.kind === 'new-branch') {
    return { mode: 'new-branch', path: operation.destination, branch: mode.branch, start: operation.base };
  }
  if (mode.kind === 'existing-branch') {
    return { mode: 'existing-branch', path: operation.destination, branch: mode.branch };
  }
  return { mode: 'detached', path: operation.destination, commit: operation.base };
};

export const subjectsOf = (operation: WorktreeIntent): WorktreeSubjects => ({
  namespaceId: operation.namespaceId,
  repository: operation.repository,
  destination: { namespaceId: operation.namespaceId, path: operation.destination },
  ref: refOf(operation.mode),
});

const receiptOf = (
  creation: WorktreeCreation,
  destination: Destination,
  retained: Retained | null,
  graphLeft?: GraphRemainder,
): WorktreeEvidence => {
  const spoken = creation.stderr === '';
  return {
    command: creation.command,
    ended: 'exit',
    status: creation.status,
    message: spoken ? creation.stdout.trim() : creation.stderr,
    overflow: spoken ? creation.overflow : creation.messageOverflow,
    unproven: null,
    destination,
    retained,
    graphLeft,
  };
};

export const endedOf = (
  command: readonly string[],
  ended: 'lost' | 'terminated' | 'unstarted',
  message: string,
  destination: Destination,
  retained: Retained | null,
): WorktreeEvidence => ({
  command,
  ended,
  status: null,
  message,
  overflow: false,
  unproven: null,
  destination,
  retained,
});

const HEAD_REFS = 'refs/heads/';

const said = (error: CreationFailure): string => `${error._tag}: ${error.message}`;

export type CreationPublication = {
  readonly producer: string;
  readonly published: (
    moved: WorktreeIntent,
    from: WorktreeRevision,
    adoption: RootAdoption,
    draft: Unrooted,
  ) => Effect.Effect<WorktreeIntent, CreationFailure>;
  readonly onRecorded: (listener: (projectId: number, rootId: RootId) => void) => () => void;
  readonly drafted: (operation: WorktreeIntent, standing: RepositoryState, path: string) => Effect.Effect<Unrooted, WorktreeUnavailable>;
  readonly unchanged: (
    operation: WorktreeIntent,
    adoption: RootAdoption,
    observed: ObservedCheckout,
  ) => Effect.Effect<void, WorktreeRefused>;
  readonly reserve: (
    opened: WorktreeIntent,
    base: string,
  ) => Effect.Effect<{ readonly taken: boolean; readonly operation: WorktreeIntent }, CreationFailure>;
  readonly registered: (
    reserved: WorktreeIntent,
    standing: RepositoryState,
    creation: WorktreeCreation,
    stands: Destination,
    graphLeft?: GraphRemainder,
  ) => Effect.Effect<WorktreeIntent, CreationFailure>;
  readonly unwritten: (
    authorized: WorktreeIntent,
    creation: WorktreeCreation,
    stands: Destination,
    retained: Retained,
    graphLeft?: GraphRemainder,
  ) => Effect.Effect<WorktreeIntent, CreationFailure>;
  readonly settle: (moved: WorktreeIntent, from: WorktreeRevision) => Effect.Effect<WorktreeIntent, CreationFailure>;
};

export const makeCreationPublication = Effect.fnUntraced(function* (input: { readonly checks: DestinationChecks }) {
  const { checks } = input;
  const intents = yield* WorktreeIntents;
  const records = yield* WorktreeRecords;
  const roots = yield* FileRoots;
  const git = yield* Git;
  const paths = yield* Path.Path;
  const units = yield* MachineUnits;
  const publishedRoot = yield* RootPublished;
  const producer = `installation-${uuidv7()}`;
  const told = new Set<(projectId: number, rootId: RootId) => void>();

  const published = Effect.fn('WorktreeCreator.published')(function* (
    moved: WorktreeIntent,
    from: WorktreeRevision,
    adoption: RootAdoption,
    draft: Unrooted,
  ): Effect.fn.Return<WorktreeIntent, CreationFailure> {
    const publication = yield* units.write(
      writes('Worktrees.settled', [fileRoot, fileRootNamespace, projectRoot, worktree, worktreeOperation]),
      (unit) =>
        Effect.gen(function* () {
          const row = yield* intents.byId(moved.operationId, unit);
          if (row === null) {
            return yield* new WorktreeMissing({
              operationId: moved.operationId,
              message: 'This creation left the registry while it was being resolved.',
            });
          }
          if (row.revision !== from) return { intent: row, root: null };
          const root = yield* roots.publish(adoption, unit);
          yield* records.record({ ...draft, rootId: root.rootId }, unit);
          const settled = { ...moved, rootId: root.rootId, revision: WorktreeRevision.make(from + 1) };
          if (yield* intents.move(settled, from, unit)) return { intent: settled, root };
          return yield* new WorktreeRefused({
            operationId: moved.operationId,
            reason: 'stale-revision',
            message: 'This creation moved inside the unit that was publishing its root.',
          });
        }),
    );
    const rootId = publication.intent.rootId;
    if (rootId !== null) for (const listener of told) listener(publication.intent.projectId, rootId);
    if (publication.root !== null) {
      yield* Effect.mapError(
        publishedRoot.published(publication.root),
        (failure) => new WorktreeUnavailable({ operationId: moved.operationId, reason: 'filesystem', message: failure.message }),
      );
    }
    return publication.intent;
  });

  const drafted = Effect.fn('WorktreeCreator.drafted')(function* (
    operation: WorktreeIntent,
    standing: RepositoryState,
    path: string,
  ): Effect.fn.Return<Unrooted, WorktreeUnavailable> {
    const branch = branchOf(operation.mode);
    const trunk = standing.head.ref?.startsWith(HEAD_REFS) ? standing.head.ref.slice(HEAD_REFS.length) : null;
    const named =
      operation.mode.kind === 'existing-branch'
        ? null
        : operation.mode.start.startsWith(HEAD_REFS)
          ? operation.mode.start.slice(HEAD_REFS.length)
          : operation.mode.start;
    const local =
      named === null
        ? null
        : yield* Effect.mapError(
            commitOf(git, standing.repository.commonDirectory, `${HEAD_REFS}${named}`),
            (failure) => new WorktreeUnavailable({ operationId: operation.operationId, reason: 'git', message: failure.message }),
          );
    const baseBranch = local !== null ? named : trunk === branch ? null : trunk;
    return {
      projectId: operation.projectId,
      name: paths.basename(operation.destination),
      path,
      branch,
      baseBranch,
      baseCommit: operation.base,
      origin: operation.operationId,
    };
  });

  const unchanged = Effect.fn('WorktreeCreator.unchanged')(function* (
    operation: WorktreeIntent,
    adoption: RootAdoption,
    observed: ObservedCheckout,
  ): Effect.fn.Return<void, WorktreeRefused> {
    if (sameWitness(adoption.root.witness, observed.witness)) return;
    return yield* new WorktreeRefused({
      operationId: operation.operationId,
      reason: 'observed-changed',
      message: `${observed.path} changed between the reading that identified it and the one that would register it.`,
    });
  });

  const settle = Effect.fn('WorktreeCreator.settle')(function* (
    moved: WorktreeIntent,
    from: WorktreeRevision,
  ): Effect.fn.Return<WorktreeIntent, CreationFailure> {
    const settled = { ...moved, revision: WorktreeRevision.make(from + 1) };
    return yield* units.write(writes('Worktrees.settle', [worktreeOperation]), (unit) =>
      Effect.gen(function* () {
        if (yield* intents.move(settled, from, unit)) return settled;
        const row = yield* intents.byId(settled.operationId, unit);
        if (row !== null) return row;
        return yield* new WorktreeMissing({
          operationId: settled.operationId,
          message: 'This creation left the registry while its outcome was settling.',
        });
      }),
    );
  });

  return {
    producer,
    published,
    onRecorded: (listener) => {
      told.add(listener);
      return () => {
        told.delete(listener);
      };
    },
    drafted,
    unchanged,
    reserve: Effect.fn('WorktreeCreator.reserve')(function* (
      opened: WorktreeIntent,
      base: string,
    ): Effect.fn.Return<{ readonly taken: boolean; readonly operation: WorktreeIntent }, CreationFailure> {
      return yield* units.write(writes('Worktrees.reserve', [worktreeOperation]), (unit) =>
        Effect.gen(function* () {
          const row = yield* intents.byId(opened.operationId, unit);
          if (row === null) {
            return yield* new WorktreeMissing({
              operationId: opened.operationId,
              message: 'This creation left the registry while it was being executed.',
            });
          }
          if (row.status !== 'pending' || row.reserved) return { taken: false, operation: row };
          if (row.base !== opened.base) {
            return yield* new WorktreeRefused({
              operationId: row.operationId,
              reason: 'stale-revision',
              message: 'The prepared base changed while its graph was being delivered.',
            });
          }
          const branch = branchOf(row.mode);
          const held = (yield* intents.holders(row.namespaceId, row.destination, row.repository.repositoryId, branch, unit)).filter(
            (other) => other.operationId !== row.operationId,
          );
          const occupant = held.find((other) => other.destination === row.destination);
          if (occupant !== undefined) {
            return yield* new WorktreeRefused({
              operationId: row.operationId,
              reason: 'destination-reserved',
              message: `${occupant.operationId} holds ${row.destination} and has not been resolved.`,
            });
          }
          const claimant = held[0];
          if (claimant !== undefined) {
            return yield* new WorktreeRefused({
              operationId: row.operationId,
              reason: 'ref-reserved',
              message: `${claimant.operationId} holds ${refOf(row.mode)} in this store and has not been resolved.`,
            });
          }
          const taken = {
            ...row,
            base,
            reserved: true,
            producer,
            revision: WorktreeRevision.make(row.revision + 1),
          };
          if (yield* intents.move(taken, row.revision, unit)) return { taken: true, operation: taken };
          return yield* new WorktreeRefused({
            operationId: row.operationId,
            reason: 'stale-revision',
            message: 'This creation moved inside the unit that was reserving it.',
          });
        }),
      );
    }),
    registered: Effect.fn('WorktreeCreator.registered')(function* (
      reserved: WorktreeIntent,
      standing: RepositoryState,
      creation: WorktreeCreation,
      stands: Destination,
      graphLeft?: GraphRemainder,
    ): Effect.fn.Return<WorktreeIntent, CreationFailure> {
      const receipt = receiptOf(creation, stands, null, graphLeft);
      const observed = yield* Effect.result(checks.observed(reserved, standing, reserved.destination));
      if (observed._tag === 'Failure') {
        return yield* settle(
          { ...reserved, status: 'uncertain', evidence: { ...receipt, unproven: said(observed.failure) } },
          reserved.revision,
        );
      }
      const adoption = yield* Effect.result(
        roots.resolve({
          path: observed.success.path,
          provenance: { kind: 'worktree', id: reserved.operationId },
          git: {
            repositoryId: standing.repository.repositoryId,
            gitDirectory: { namespaceId: roots.namespaceId, path: observed.success.gitDirectory },
          },
        }),
      );
      if (Result.isFailure(adoption)) {
        return yield* settle(
          { ...reserved, status: 'uncertain', evidence: { ...receipt, unproven: said(adoption.failure) } },
          reserved.revision,
        );
      }
      const bound = yield* Effect.result(unchanged(reserved, adoption.success, observed.success));
      if (Result.isFailure(bound)) {
        return yield* settle(
          { ...reserved, status: 'uncertain', evidence: { ...receipt, unproven: said(bound.failure) } },
          reserved.revision,
        );
      }
      const draft = yield* Effect.result(drafted(reserved, standing, observed.success.path));
      if (Result.isFailure(draft)) {
        return yield* settle(
          { ...reserved, status: 'uncertain', evidence: { ...receipt, unproven: said(draft.failure) } },
          reserved.revision,
        );
      }
      const done = yield* Effect.result(
        published({ ...reserved, status: 'ready', evidence: receipt }, reserved.revision, adoption.success, draft.success),
      );
      if (Result.isSuccess(done)) return done.success;
      return yield* settle({ ...reserved, status: 'uncertain', evidence: { ...receipt, unproven: said(done.failure) } }, reserved.revision);
    }),
    unwritten: (authorized, creation, stands, retained, graphLeft) =>
      settle(
        {
          ...authorized,
          status: stands === 'absent' && retained.length === 0 ? 'failed' : 'uncertain',
          evidence: receiptOf(creation, stands, retained, graphLeft),
        },
        authorized.revision,
      ),
    settle,
  } satisfies CreationPublication;
});
