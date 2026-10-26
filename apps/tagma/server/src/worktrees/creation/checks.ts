import type { RequestKey } from '../../platform/contract/wire/ids.js';
import { Effect, FileSystem, Option, Path, Result } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import type { IdentityWitness } from '@runlith/files/namespace';
import { witnessOf } from '@runlith/files/witness';
import { commitOf, locationsAt, troubleOf } from '@runlith/git/repository';
import { worktreesOf } from '@runlith/git/worktree';
import { Git } from '@runlith/git/Git';
import type { RepositoryState } from '../../workspace/contract/wire/repositories.js';
import {
  refOf,
  type ObservedCheckout,
  type WorktreeEvidence,
  type WorktreeIntent,
  type WorktreeRequest,
} from '../contract/wire/creation.js';
import { WorktreeRefused, WorktreeUnavailable } from '../contract/wire/failures.js';

export type Destination = WorktreeEvidence['destination'];

export type Retained = readonly ('registration' | 'ref' | 'unreadable')[];

type Failure = WorktreeRefused | WorktreeUnavailable;

export type DestinationChecks = {
  readonly observed: (operation: WorktreeIntent, standing: RepositoryState, path: string) => Effect.Effect<ObservedCheckout, Failure>;
  readonly ref: (operationId: RequestKey, standing: RepositoryState, intent: WorktreeRequest) => Effect.Effect<void, Failure>;
  readonly place: (operationId: RequestKey, path: string) => Effect.Effect<string, Failure>;
  readonly witness: (operationId: RequestKey, path: string) => Effect.Effect<IdentityWitness, Failure>;
  readonly canonical: (operationId: RequestKey, path: string) => Effect.Effect<string | null, WorktreeUnavailable>;
  readonly commit: (dir: string, revision: string) => Effect.Effect<string | null, WorktreeUnavailable>;
  readonly retained: (operation: WorktreeIntent, common: string) => Effect.Effect<Retained>;
  readonly free: (operation: WorktreeIntent, standing: RepositoryState) => Effect.Effect<void, Failure>;
  readonly vacant: (operationId: RequestKey, destination: string) => Effect.Effect<void, Failure>;
  readonly stands: (path: string) => Effect.Effect<Destination>;
};

export const makeDestinationChecks = Effect.gen(function* () {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const io = <A>(operationId: RequestKey, work: Effect.Effect<A, PlatformError>) =>
    Effect.mapError(
      work,
      (error) =>
        new WorktreeUnavailable({
          operationId,
          reason: 'filesystem',
          message: error.message,
        }),
    );

  const canonical = Effect.fn('WorktreeCreator.canonical')(function* (
    operationId: RequestKey,
    path: string,
  ): Effect.fn.Return<string | null, WorktreeUnavailable> {
    const seen = yield* Effect.result(files.realPath(path));
    if (Result.isSuccess(seen)) return seen.success;
    if (seen.failure.reason._tag === 'NotFound') return null;
    return yield* new WorktreeUnavailable({
      operationId,
      reason: 'filesystem',
      message: seen.failure.message,
    });
  });

  const commit = Effect.fn('WorktreeCreator.commit')(function* (
    dir: string,
    revision: string,
  ): Effect.fn.Return<string | null, WorktreeUnavailable> {
    return yield* commitOf(git, dir, revision).pipe(
      Effect.mapError((error) => new WorktreeUnavailable({ reason: 'git', message: troubleOf(error) })),
    );
  });

  const witness = Effect.fn('WorktreeCreator.witness')(function* (
    operationId: RequestKey,
    path: string,
  ): Effect.fn.Return<IdentityWitness, Failure> {
    const info = yield* io(operationId, files.stat(path));
    const minted = witnessOf({
      type: info.type,
      inode: Option.getOrNull(info.ino),
      birthtime: Option.isNone(info.birthtime) ? null : info.birthtime.value.getTime(),
    });
    if (Result.isSuccess(minted)) return minted.success;
    return yield* new WorktreeUnavailable({
      operationId,
      reason: 'filesystem',
      message: `The filesystem supplied no usable ${minted.failure} identity for ${path}.`,
    });
  });

  const ref = Effect.fn('WorktreeCreator.ref')(function* (
    operationId: RequestKey,
    standing: RepositoryState,
    intent: WorktreeRequest,
  ): Effect.fn.Return<void, Failure> {
    const named = refOf(intent.mode);
    if (named === null) return;
    const held = yield* commit(standing.repository.commonDirectory, named);
    if (intent.mode.kind === 'new-branch' && held !== null) {
      return yield* new WorktreeRefused({
        operationId,
        reason: 'ref-occupied',
        message: `${named} already stands at ${held}.`,
      });
    }
    if (intent.mode.kind === 'existing-branch' && held === null) {
      return yield* new WorktreeRefused({
        operationId,
        reason: 'ref-missing',
        message: `${named} names no commit in this store.`,
      });
    }
  });

  return {
    observed: Effect.fn('WorktreeCreator.observed')(function* (
      operation: WorktreeIntent,
      standing: RepositoryState,
      path: string,
    ): Effect.fn.Return<ObservedCheckout, Failure> {
      const found = yield* canonical(operation.operationId, path);
      if (found === null || found !== operation.destination) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'observed-mismatch',
          message:
            found === null
              ? `Nothing stands at ${path}, so it is not the checkout this creation reserved.`
              : `${path} stands at ${found}, and this creation reserved ${operation.destination}.`,
        });
      }
      const locations = yield* locationsAt(git, found).pipe(
        Effect.mapError(
          (error) =>
            new WorktreeUnavailable({
              operationId: operation.operationId,
              reason: 'git',
              message: troubleOf(error),
            }),
        ),
      );
      if (locations.worktree !== found) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'observed-mismatch',
          message: `git reads ${found} as part of the checkout at ${locations.worktree ?? 'no checkout'}.`,
        });
      }
      if (locations.commonDir !== standing.repository.commonDirectory) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'observed-mismatch',
          message: `The checkout at ${found} keeps its objects in ${locations.commonDir}, and this creation was prepared against the store at ${standing.repository.commonDirectory}.`,
        });
      }
      if (locations.gitDir === locations.commonDir) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'observed-mismatch',
          message: `${found} is the main worktree of this store, which no creation makes.`,
        });
      }
      return { path: found, witness: yield* witness(operation.operationId, found), gitDirectory: locations.gitDir };
    }),
    ref,
    place: Effect.fn('WorktreeCreator.place')(function* (operationId: RequestKey, path: string): Effect.fn.Return<string, Failure> {
      if (!paths.isAbsolute(path)) {
        return yield* new WorktreeRefused({
          operationId,
          reason: 'relative-path',
          message: 'A creation takes an absolute destination in the supplied namespace.',
        });
      }
      const parent = yield* canonical(operationId, paths.dirname(path));
      if (parent === null) {
        return yield* new WorktreeRefused({
          operationId,
          reason: 'parent-missing',
          message: `${paths.dirname(path)} does not stand, so there is nowhere to make ${paths.basename(path)}.`,
        });
      }
      return paths.join(parent, paths.basename(path));
    }),
    witness,
    canonical,
    commit,
    retained: Effect.fn('WorktreeCreator.retained')(function* (
      operation: WorktreeIntent,
      common: string,
    ): Effect.fn.Return<Retained, never> {
      const found = new Set<Retained[number]>();
      const listed = yield* Effect.result(worktreesOf(git, common));
      if (Result.isFailure(listed)) {
        yield* Effect.logWarning('what a creation left registered could not be read', {
          operationId: operation.operationId,
          reason: troubleOf(listed.failure),
        });
        found.add('unreadable');
      } else if (listed.success.some((one) => one.path === operation.destination)) found.add('registration');
      const named = operation.mode.kind === 'new-branch' ? refOf(operation.mode) : null;
      if (named !== null) {
        const held = yield* Effect.result(commitOf(git, common, named));
        if (Result.isFailure(held)) {
          yield* Effect.logWarning('the ref a creation may have left could not be read', {
            operationId: operation.operationId,
            ref: named,
            reason: troubleOf(held.failure),
          });
          found.add('unreadable');
        } else if (held.success !== null) found.add('ref');
      }
      return [...found].sort();
    }),
    free: Effect.fn('WorktreeCreator.free')(function* (
      operation: WorktreeIntent,
      standing: RepositoryState,
    ): Effect.fn.Return<void, Failure> {
      if (yield* io(operation.operationId, files.exists(operation.destination))) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'destination-occupied',
          message: `${operation.destination} stands now; this creation was prepared over a place that was free.`,
        });
      }
      const listing = yield* worktreesOf(git, standing.repository.commonDirectory).pipe(
        Effect.mapError(
          (error) => new WorktreeUnavailable({ operationId: operation.operationId, reason: 'git', message: troubleOf(error) }),
        ),
      );
      if (listing.some((one) => one.path === operation.destination)) {
        return yield* new WorktreeRefused({
          operationId: operation.operationId,
          reason: 'destination-occupied',
          message: `${standing.repository.commonDirectory} already lists a checkout at ${operation.destination}.`,
        });
      }
      yield* ref(operation.operationId, standing, operation);
    }),
    vacant: Effect.fn('WorktreeCreator.vacant')(function* (operationId: RequestKey, destination: string): Effect.fn.Return<void, Failure> {
      if (yield* io(operationId, files.exists(destination))) {
        return yield* new WorktreeRefused({
          operationId,
          reason: 'destination-occupied',
          message: `${destination} already stands.`,
        });
      }
    }),
    stands: Effect.fn('WorktreeCreator.stands')(function* (path: string): Effect.fn.Return<Destination, never> {
      const seen = yield* Effect.result(files.exists(path));
      if (Result.isFailure(seen)) {
        yield* Effect.logWarning('whether a creation destination stands could not be read', { path, reason: seen.failure.message });
        return 'unreadable';
      }
      return seen.success ? 'present' : 'absent';
    }),
  };
});
