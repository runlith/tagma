import { Effect, FileSystem, Option, Path, Result } from 'effect';
import { uuidv7 } from 'uuidv7';
import { type Head, headAt, type Store, type StoreHead, storeAt, storeHeadAt, troubleOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { Repositories } from '../contract/service/repositories.js';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { sameFormat, sameWitness, witnessOf } from '@runlith/files/witness';
import { LocationRevision } from '@runlith/files/resource';
import {
  RepositoryId,
  RepositoryConflict,
  RepositoryBaseMissing,
  RepositoryInvalid,
  RepositoryMissing,
  RepositoryRefused,
  RepositoryUnavailable,
  RepositoryUnreadable,
  type Repository,
  type RepositoryBase,
  type RepositoryBinding,
  type RepositoryFailure,
  type RepositoryRegistration,
  type RepositoryState,
} from '../contract/wire/repositories.js';
import { storageUnavailable, type RepositoryStore, type RepositoryStoreFailure } from '../store/repositories.js';
import { outsideRepository } from './discovery.js';

type StoreFact = {
  readonly path: string;
  readonly witness: IdentityWitness;
};

type Failure = RepositoryFailure | RepositoryStoreFailure;

const DISCOVERY = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'] as const;

export type RepositoryRegistry = Repositories['Service'];

export const makeRepositoryRegistry = Effect.fnUntraced(function* ({
  store,
  namespaceId,
  environment = process.env,
}: {
  readonly store: RepositoryStore;
  readonly namespaceId: NamespaceId;
  readonly environment?: Record<string, string | undefined>;
}) {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;

  const register = Effect.fn('Repositories.register')(
    function* (input: RepositoryRegistration): Effect.fn.Return<Repository, Failure> {
      const fact = yield* probe((yield* asked(input.path)).commonDir);
      const candidates = yield* store.candidates(namespaceId, fact.path, fact.witness);
      const known = candidates.find((row) => sameWitness(row.witness, fact.witness));
      if (known !== undefined && known.commonDirectory !== fact.path) return yield* moved(known, fact.path);
      const standing = candidates.find((row) => row.commonDirectory === fact.path) ?? null;
      if (standing !== null) yield* comparable(standing, fact.witness);
      return yield* store.adopt({
        repository: {
          repositoryId: RepositoryId.make(uuidv7()),
          namespaceId,
          commonDirectory: fact.path,
          locationRevision: LocationRevision.make(0),
          witness: fact.witness,
          projectId: input.projectId,
          state: 'active',
        },
        checked: candidates,
        replaced: standing !== null && !sameWitness(standing.witness, fact.witness) ? standing : null,
      });
    },
    (work, input) => Effect.mapError(work, (error) => failure(error, input.path)),
  );

  const read = Effect.fn('Repositories.read')(
    function* (repositoryId: RepositoryId, locationRevision?: LocationRevision): Effect.fn.Return<RepositoryState, Failure> {
      const repository = yield* checked(repositoryId, locationRevision);
      const fact = yield* probe(repository.commonDirectory);
      yield* comparable(repository, fact.witness);
      if (!sameWitness(repository.witness, fact.witness)) {
        return yield* stale(
          repository,
          repository.witness.token,
          fact.witness.token,
          'The registered address holds a different object than this store was registered over.',
        );
      }
      if (fact.path !== repository.commonDirectory) {
        return yield* moved(repository, fact.path);
      }
      const location = yield* asked(fact.path, true);
      const answered = yield* probe(location.commonDir);
      if (!sameWitness(answered.witness, fact.witness)) {
        return yield* stale(
          repository,
          fact.path,
          answered.path,
          'The registered directory is no longer read as this store\u2019s own common directory.',
        );
      }
      return { repository, bare: location.bare, head: location.head ?? (yield* head(fact.path)) };
    },
    (work, repositoryId, _locationRevision?) => Effect.mapError(work, (error) => failure(error, undefined, repositoryId)),
  );

  const at = Effect.fn('Repositories.at')(
    function* (path: string): Effect.fn.Return<string, Failure> {
      return (yield* probe((yield* asked(path)).commonDir)).path;
    },
    (work, path) => Effect.mapError(work, (error) => failure(error, path)),
  );

  const base = Effect.fn('Repositories.base')(
    function* (repositoryId: RepositoryId, locationRevision?: LocationRevision): Effect.fn.Return<RepositoryBase, Failure> {
      const standing = yield* read(repositoryId, locationRevision);
      if (standing.head.commit === null) {
        return yield* new RepositoryBaseMissing({
          repositoryId: standing.repository.repositoryId,
          namespaceId,
          commonDirectory: standing.repository.commonDirectory,
          ref: standing.head.ref,
          message:
            standing.head.ref === null
              ? 'This store resolves HEAD to no commit, so it offers no base object.'
              : `This store stands on ${standing.head.ref}, which carries no commit yet.`,
        });
      }
      return { repository: standing.repository, commit: standing.head.commit };
    },
    (work, repositoryId, _locationRevision?) => Effect.mapError(work, (error) => failure(error, undefined, repositoryId)),
  );

  const relocate = Effect.fn('Repositories.relocate')(
    function* (binding: RepositoryBinding, path: string): Effect.fn.Return<Repository, Failure> {
      const repository = yield* checked(binding.repositoryId, binding.locationRevision);
      const fact = yield* probe((yield* asked(path)).commonDir);
      yield* comparable(repository, fact.witness);
      if (!sameWitness(repository.witness, fact.witness)) {
        return yield* new RepositoryConflict({
          namespaceId,
          path: fact.path,
          reason: 'binding-mismatch',
          message: 'The named place belongs to a different store than this registration.',
        });
      }
      if (fact.path === repository.commonDirectory) return repository;
      if (repository.locationRevision === Number.MAX_SAFE_INTEGER) {
        return yield* new RepositoryRefused({
          namespaceId,
          path: repository.commonDirectory,
          reason: 'revision-exhausted',
          message: 'The location revision counter is exhausted.',
        });
      }
      return yield* store.relocate(
        { ...repository, commonDirectory: fact.path, locationRevision: LocationRevision.make(repository.locationRevision + 1) },
        repository,
      );
    },
    (work, binding, path) => Effect.mapError(work, (error) => failure(error, path, binding.repositoryId)),
  );

  const checked = Effect.fn('Repositories.checked')(function* (
    repositoryId: RepositoryId,
    locationRevision?: LocationRevision,
  ): Effect.fn.Return<Repository, Failure> {
    const row = yield* store.byId(repositoryId);
    if (row === null || row.namespaceId !== namespaceId) {
      return yield* new RepositoryMissing({
        namespaceId,
        repositoryId,
        message: 'This namespace has no registration with that repository identity.',
      });
    }
    if (row.state === 'replaced') {
      return yield* stale(
        row,
        undefined,
        undefined,
        'This address belongs to another registration, which took it over; it will not answer for this store again.',
      );
    }
    if (locationRevision !== undefined && row.locationRevision !== locationRevision) {
      return yield* new RepositoryConflict({
        namespaceId,
        path: row.commonDirectory,
        reason: 'stale-binding',
        message: 'The requested location revision is stale.',
      });
    }
    return row;
  });

  const comparable = Effect.fn('Repositories.comparable')(function* (
    row: Repository,
    witness: IdentityWitness,
  ): Effect.fn.Return<void, RepositoryInvalid> {
    if (sameFormat(row.witness, witness)) return;
    return yield* new RepositoryInvalid({
      namespaceId,
      path: row.commonDirectory,
      reason: 'identity-format',
      message: `This registration was witnessed as ${row.witness.provider}/${row.witness.format}, and this reading witnesses as ${witness.provider}/${witness.format}.`,
    });
  });

  function moved(row: Repository, found: string): Effect.Effect<never, RepositoryConflict> {
    return Effect.fail(
      new RepositoryConflict({
        repositoryId: row.repositoryId,
        namespaceId: row.namespaceId,
        locationRevision: row.locationRevision,
        registered: row.commonDirectory,
        found,
        reason: 'moved',
        message: `This store is registered at ${row.commonDirectory} and answers at ${found} now.`,
      }),
    );
  }

  function stale(
    row: Repository,
    expected: string | undefined,
    found: string | undefined,
    message: string,
  ): Effect.Effect<never, RepositoryConflict> {
    return Effect.fail(
      new RepositoryConflict({
        repositoryId: row.repositoryId,
        namespaceId: row.namespaceId,
        commonDirectory: row.commonDirectory,
        locationRevision: row.locationRevision,
        reason: 'replaced',
        expected,
        found,
        message,
      }),
    );
  }

  const asked = Effect.fn('Repositories.asked')(function* (
    path: string,
    withHead = false,
  ): Effect.fn.Return<Store & { readonly head: Head | null }, Failure> {
    if (!paths.isAbsolute(path)) {
      return yield* new RepositoryInvalid({
        namespaceId,
        path,
        reason: 'relative-path',
        message: 'Resolution requires an absolute path in the supplied namespace.',
      });
    }
    const named = DISCOVERY.filter((name) => (environment[name] ?? '').trim() !== '');
    if (named.length > 0) {
      return yield* new RepositoryRefused({
        namespaceId,
        path,
        reason: 'discovery-overridden',
        message: `git resolves its repository from ${named.join(', ')} here, so what it answers is that repository and not what ${path} holds.`,
      });
    }
    const discovery = yield* Effect.result(
      withHead ? storeHeadAt(git, path) : Effect.map(storeAt(git, path), (store): StoreHead => ({ store, head: null })),
    );
    if (Result.isSuccess(discovery)) return { ...discovery.success.store, head: discovery.success.head };
    if (discovery.failure._tag !== 'GitRefused') {
      return yield* new RepositoryUnavailable({
        namespaceId,
        path,
        reason: 'git',
        message: troubleOf(discovery.failure),
      });
    }
    if (!(yield* io(files.exists(path), path))) {
      return yield* new RepositoryMissing({
        namespaceId,
        path,
        message: `Nothing stands at ${path}.`,
      });
    }
    const outside = yield* outsideRepository(files, path).pipe(
      Effect.catchTag('DiscoveryUnreadable', (unreadable) => io(Effect.fail(unreadable.error), unreadable.path)),
    );
    return yield* outside
      ? new RepositoryMissing({
          namespaceId,
          path,
          reason: 'no-repository',
          message: `Nothing here or above it is anything git could open, and git found none: ${troubleOf(discovery.failure)}`,
        })
      : new RepositoryUnreadable({
          namespaceId,
          path,
          message: `git refused this place, and it holds something git may have found: ${troubleOf(discovery.failure)}`,
        });
  });

  const head = Effect.fn('Repositories.head')((path: string) =>
    headAt(git, path).pipe(
      Effect.mapError(
        (error) =>
          new RepositoryUnavailable({
            namespaceId,
            path,
            reason: 'git',
            message: troubleOf(error),
          }),
      ),
    ),
  );

  const probe = Effect.fn('Repositories.probe')(function* (path: string): Effect.fn.Return<StoreFact, Failure> {
    if (!paths.isAbsolute(path)) {
      return yield* new RepositoryInvalid({
        namespaceId,
        path,
        reason: 'relative-path',
        message: 'Resolution requires an absolute path in the supplied namespace.',
      });
    }
    const canonical = yield* io(files.realPath(path), path);
    const witness = yield* witnessed(yield* io(files.stat(canonical), canonical), canonical);
    const checked = yield* witnessed(yield* io(files.stat(path), path), path);
    if (!sameWitness(witness, checked)) {
      return yield* new RepositoryConflict({
        namespaceId,
        path,
        reason: 'resource-changed',
        message: 'The directory changed while its identity was being read.',
      });
    }
    return { path: canonical, witness };
  });

  function witnessed(info: FileSystem.File.Info, path: string): Effect.Effect<IdentityWitness, RepositoryUnavailable> {
    const minted = witnessOf({
      type: info.type,
      inode: Option.getOrNull(info.ino),
      birthtime: Option.isNone(info.birthtime) ? null : info.birthtime.value.getTime(),
    });
    return Result.isFailure(minted)
      ? Effect.fail(
          new RepositoryUnavailable({
            namespaceId,
            path,
            reason: 'identity-unavailable',
            message:
              minted.failure === 'inode'
                ? 'The filesystem did not supply a usable inode.'
                : 'The filesystem did not supply a usable birthtime identity witness.',
          }),
        )
      : Effect.succeed(minted.success);
  }

  function failure(error: Failure, path?: string, repositoryId?: RepositoryId): RepositoryFailure {
    switch (error._tag) {
      case 'RepositoryMissing':
      case 'RepositoryUnavailable':
      case 'RepositoryConflict':
      case 'RepositoryBaseMissing':
      case 'RepositoryInvalid':
      case 'RepositoryUnreadable':
      case 'RepositoryRefused':
        return error;
      default:
        return storageUnavailable(namespaceId, error, path, repositoryId);
    }
  }

  function io<A>(work: Effect.Effect<A, import('effect/PlatformError').PlatformError>, path: string) {
    return Effect.mapError(work, (error) =>
      error.reason._tag === 'NotFound'
        ? new RepositoryMissing({ namespaceId, path, message: error.message })
        : error.reason._tag === 'BadResource'
          ? new RepositoryUnreadable({ namespaceId, path, message: error.message })
          : new RepositoryUnavailable({ namespaceId, path, reason: 'filesystem', message: error.message }),
    );
  }

  return Repositories.of({ register, read, at, base, relocate });
});
