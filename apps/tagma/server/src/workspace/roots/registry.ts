import { Effect, FileSystem, Option, Path, Result, Semaphore } from 'effect';
import { uuidv7 } from 'uuidv7';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import { coordinateOf, sameWitness, witnessOf } from '@runlith/files/witness';
import { LocationRevision, type ResourceAddress } from '@runlith/files/resource';
import { RootId } from '../contract/wire/ids.js';
import {
  RootConflict,
  RootInvalid,
  RootMissing,
  RootRefused,
  RootUnavailable,
  isRegistryChanged,
  type FileRoot,
  type RootBinding,
  type RootFootprint,
  type RootRegistration,
  type RootResolutionFailure,
  type RootGit,
} from '../contract/wire/roots.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { type FileRootStore, storageUnavailable, type RootStoreFailure } from '../store/rootRegistry.js';
import {
  FileRoots,
  RootReservations,
  type DirectoryFact,
  type RootAdoption,
  type RootScope,
  type RootMatch,
} from '../contract/service/roots.js';
import { FootprintIndex } from './footprint.js';

type RootFailure = RootResolutionFailure | RootStoreFailure;

export type RootRegistry = FileRoots['Service'];

export const makeRootRegistry = Effect.fnUntraced(function* ({
  store,
  namespaceId,
}: {
  readonly store: FileRootStore;
  readonly namespaceId: NamespaceId;
}) {
  const files = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const reservations = yield* RootReservations;

  const register = Effect.fn('FileRoots.register')(
    function* (input: RootRegistration): Effect.fn.Return<FileRoot, RootFailure> {
      const adoption = yield* resolve(input);
      return yield* store.write((unit) => publish(adoption, unit));
    },
    (work) => Effect.retry(work, { while: isRegistryChanged }),
    (work, input) => Effect.mapError(work, (error) => failure(error, input.path)),
  );

  const resolve = Effect.fn('FileRoots.resolve')(
    function* (input: RootRegistration): Effect.fn.Return<RootAdoption, RootFailure> {
      const fact = yield* probe(input.path);
      if (fact.type !== 'Directory') {
        return yield* new RootInvalid({
          namespaceId,
          path: input.path,
          reason: 'not-directory',
          message: 'A file root must be a directory.',
        });
      }
      const candidates = yield* store.candidates(namespaceId, fact.path, fact.witness);
      const replaced: FileRoot[] = [];
      let duplicate: FileRoot | null = null;
      let moved: FileRoot | null = null;
      for (const root of candidates) {
        const current = yield* probe(root.path).pipe(
          Effect.catchTag('RootMissing', (missing) => (same(root.witness, fact.witness) ? Effect.succeed(null) : missing)),
        );
        if (current === null) {
          moved = root;
          continue;
        }
        if (!same(root.witness, current.witness)) {
          if (same(root.witness, fact.witness)) moved = root;
          else replaced.push(root);
        } else if (same(fact.witness, current.witness)) {
          duplicate = root;
        }
      }
      const current = yield* probe(input.path);
      if (!same(fact.witness, current.witness) || fact.path !== current.path) {
        return yield* new RootConflict({
          namespaceId,
          path: input.path,
          reason: 'resource-changed',
          message: 'The directory changed during registration.',
        });
      }
      if (moved !== null && moved.locationRevision === Number.MAX_SAFE_INTEGER) {
        return yield* new RootRefused({
          namespaceId,
          path: moved.path,
          reason: 'revision-exhausted',
          message: 'The location revision counter is exhausted.',
        });
      }
      return {
        root:
          moved !== null
            ? {
                ...moved,
                path: fact.path,
                locationRevision: LocationRevision.make(moved.locationRevision + 1),
                git: input.git === undefined ? moved.git : input.git,
              }
            : {
                rootId: RootId.make(uuidv7()),
                namespaceId,
                path: fact.path,
                locationRevision: LocationRevision.make(0),
                witness: fact.witness,
                provenance: input.provenance,
                git: input.git ?? null,
                state: 'active',
              },
        facet: input.git,
        checked: candidates,
        replaced,
        duplicate,
        moved,
      } satisfies RootAdoption;
    },
    (work, input) => Effect.mapError(work, (error) => failure(error, input.path)),
  );

  const matching = Effect.fn('FileRoots.matching')(
    function* (path: string): Effect.fn.Return<RootMatch | null, RootFailure> {
      const fact = yield* probe(path);
      if (fact.type !== 'Directory') return null;
      const candidates = yield* store.candidates(namespaceId, fact.path, fact.witness);
      const root = candidates.find((root) => same(root.witness, fact.witness));
      return root === undefined ? null : { root, path: fact.path };
    },
    (work, path) => Effect.mapError(work, (error) => failure(error, path)),
  );

  const relocate = Effect.fn('FileRoots.relocate')(
    function* (match: RootMatch, git?: RootGit | null): Effect.fn.Return<FileRoot, RootFailure> {
      const adoption = yield* resolve({ path: match.path, provenance: match.root.provenance, git });
      if ((adoption.moved ?? adoption.duplicate)?.rootId !== match.root.rootId)
        return yield* new RootConflict({
          namespaceId,
          path: match.path,
          reason: 'resource-changed',
          message: 'The matched directory changed before its registration could follow it.',
        });
      return yield* store.write((unit) => publish(adoption, unit));
    },
    (work) => Effect.retry(work, { while: isRegistryChanged }),
    (work, match) => Effect.mapError(work, (error) => failure(error, match.path)),
  );

  const publishAll = Effect.fn('FileRoots.publishAll')(
    function* (
      adoptions: readonly RootAdoption[],
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<readonly Result.Result<FileRoot, RootConflict>[], RootFailure> {
      const holds = yield* reservations.holding(
        namespaceId,
        adoptions.map((adoption) => adoption.root.path),
        unit,
      );
      const refused = new Map<number, RootConflict>();
      const admitted: RootAdoption[] = [];
      for (const [at, adoption] of adoptions.entries()) {
        const { root } = adoption;
        const refusing = (holds.get(root.path) ?? []).filter(
          (hold) => !hold.admits.some((admits) => admits.kind === root.provenance.kind && admits.id === root.provenance.id),
        );
        if (refusing.length === 0) {
          admitted.push(adoption);
          continue;
        }
        refused.set(
          at,
          new RootConflict({
            namespaceId,
            path: root.path,
            reason: 'reserved',
            message: `This place is held by ${refusing.map((hold) => `${hold.owner} ${hold.holder}`).join(', ')}; only the registration it is waiting for may take it.`,
          }),
        );
      }
      const settled = (yield* store.settleAll(admitted, unit)).values();
      return adoptions.map((_, at): Result.Result<FileRoot, RootConflict> => {
        const refusal = refused.get(at);
        return refusal === undefined ? Result.succeed(settled.next().value!) : Result.fail(refusal);
      });
    },
    (work, adoptions) => Effect.mapError(work, (error) => failure(error, adoptions[0]?.root.path)),
  );

  const publish = Effect.fn('FileRoots.publish')(function* (
    adoption: RootAdoption,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<FileRoot, RootResolutionFailure> {
    const [answer] = yield* publishAll([adoption], unit);
    if (answer === undefined) return yield* Effect.die('a publication of one adoption answered none');
    return yield* Effect.fromResult(answer);
  });

  const read = Effect.fn('FileRoots.read')(
    function* (rootId: RootId, locationRevision?: LocationRevision): Effect.fn.Return<FileRoot, RootFailure> {
      const root = yield* checked(rootId, locationRevision);
      yield* check(root);
      return yield* checked(rootId, root.locationRevision);
    },
    (work, rootId, _locationRevision?) => Effect.mapError(work, (error) => failure(error, undefined, rootId)),
  );

  const checked = Effect.fn('FileRoots.checked')(
    function* (rootId: RootId, locationRevision?: LocationRevision, tx?: Unit<'machine'>) {
      return yield* judge(yield* store.byId(rootId, tx), { rootId, locationRevision });
    },
    (work, rootId, _locationRevision?, _tx?) => Effect.mapError(work, (error) => failure(error, undefined, rootId)),
  );

  const checkedAll = Effect.fn('FileRoots.checkedAll')(
    function* (bindings: readonly RootBinding[], tx?: Unit<'machine'>): Effect.fn.Return<readonly FileRoot[], RootFailure> {
      const rows = new Map(
        (yield* store.byIds(
          bindings.map((binding) => binding.rootId),
          tx,
        )).map((root) => [root.rootId, root] as const),
      );
      return yield* Effect.forEach(bindings, (binding) => judge(rows.get(binding.rootId) ?? null, binding));
    },
    (work, bindings) => Effect.mapError(work, (error) => failure(error, undefined, bindings[0]?.rootId)),
  );

  const live = Effect.fn('FileRoots.live')(
    function* (rootIds: readonly RootId[], tx?: Unit<'machine'>): Effect.fn.Return<readonly FileRoot[], RootFailure> {
      const rows = yield* store.byIds(rootIds, tx);
      return rows.filter((row) => row.namespaceId === namespaceId && row.state === 'active');
    },
    (work) => Effect.mapError(work, (error) => failure(error)),
  );

  const active = Effect.fn('FileRoots.active')(
    () => store.active(namespaceId),
    (work) => Effect.mapError(work, (error) => failure(error)),
  );

  const judge = Effect.fn('FileRoots.judge')(function* (
    root: FileRoot | null,
    binding: { rootId: RootId; locationRevision?: LocationRevision },
  ): Effect.fn.Return<FileRoot, RootResolutionFailure> {
    if (root === null || root.namespaceId !== namespaceId || root.state === 'retired') {
      return yield* new RootMissing({
        namespaceId,
        rootId: binding.rootId,
        message: 'This namespace has no live registration with that root identity.',
      });
    }
    if (root.state === 'replaced')
      return yield* new RootConflict({ ...root, reason: 'replaced', message: 'This registration names a replaced occupant.' });
    if (binding.locationRevision !== undefined && root.locationRevision !== binding.locationRevision) {
      return yield* new RootConflict({
        namespaceId,
        path: root.path,
        reason: 'stale-binding',
        message: 'The requested location revision is stale.',
      });
    }
    return root;
  });

  function scope(): RootScope {
    const gate = Semaphore.makeUnsafe(1);
    let index: FootprintIndex | undefined;
    const admitted = new Map<string, RootFootprint>();
    const resolve = Effect.fn('FileRoots.scope.resolve')(
      function* (path: string, binding?: RootBinding): Effect.fn.Return<RootFootprint, RootFailure> {
        if (binding !== undefined) yield* read(binding.rootId, binding.locationRevision);
        let footprint = admitted.get(path);
        if (footprint === undefined) {
          const ancestors = new Map<string, string>();
          const fact = yield* probe(path, ancestors);
          if (index === undefined) {
            index = yield* snapshot(ancestors, path, fact);
            footprint = footprintOf(index, fact);
          } else {
            yield* refresh(index, ancestors);
            footprint = yield* recheck(footprintOf(index, fact), path);
          }
        } else {
          footprint = yield* recheck(footprint, path);
        }
        const bound = binding === undefined ? undefined : footprint.roots.find(({ root }) => root.rootId === binding.rootId);
        if (binding !== undefined && bound === undefined) {
          return yield* new RootConflict({
            namespaceId,
            path,
            reason: 'binding-mismatch',
            message: 'The requested root binding does not overlap this resource.',
          });
        }
        if (binding?.locationRevision !== undefined && bound?.root.locationRevision !== binding.locationRevision) {
          return yield* new RootConflict({
            namespaceId,
            path,
            reason: 'stale-binding',
            message: 'The requested location revision went stale while this resource was resolved.',
          });
        }
        admitted.set(path, footprint);
        return footprint;
      },
      (work, path, _binding?: RootBinding) => Effect.mapError(work, (error) => failure(error, path)),
    );
    return { resolve: (path, binding) => gate.withPermit(resolve(path, binding)) };
  }

  const resolveFootprint = Effect.fn('FileRoots.resolveFootprint')((path: string, binding?: RootBinding) => scope().resolve(path, binding));

  function footprintOf(index: FootprintIndex, fact: DirectoryFact): RootFootprint {
    return {
      status: 'complete',
      resource: { namespaceId, path: fact.path },
      witness: fact.witness,
      registryRevision: index.revision,
      roots: index.overlaps(fact),
    };
  }

  const standing = Effect.fn('FileRoots.standing')(function* (root: FileRoot, ancestors: Map<string, string>) {
    const checked = yield* Effect.result(check(root, ancestors));
    if (checked._tag === 'Success') return checked.success;
    const refused = checked.failure;
    if (refused._tag === 'RootMissing') return null;
    if (refused._tag === 'RootConflict' && refused.reason === 'replaced') return 'replaced' as const;
    return yield* refused;
  });

  const snapshot = Effect.fn('FileRoots.snapshot')(function* (
    ancestors: Map<string, string>,
    path: string,
    fact: DirectoryFact,
  ): Effect.fn.Return<FootprintIndex, RootFailure> {
    const revision = yield* store.revision(namespaceId);
    const index = new FootprintIndex(revision);
    let replaced = false;
    yield* Effect.forEach(
      yield* store.active(namespaceId),
      (root) =>
        Effect.map(standing(root, ancestors), (current) => {
          if (current === 'replaced') replaced = true;
          else if (current !== null) index.add(root, current);
        }),
      { concurrency: 3, discard: true },
    );
    if (replaced) return yield* snapshot(ancestors, path, fact);
    const current = yield* probe(path);
    if (!same(fact.witness, current.witness) || fact.path !== current.path) {
      return yield* new RootConflict({
        namespaceId,
        path,
        reason: 'resource-changed',
        message: 'The requested resource changed during footprint resolution.',
      });
    }
    yield* refresh(index, ancestors);
    return index;
  });

  const refresh = Effect.fn('FileRoots.refresh')(function* (
    index: FootprintIndex,
    ancestors: Map<string, string>,
  ): Effect.fn.Return<void, RootFailure> {
    for (;;) {
      const changed = yield* store.changesSince(namespaceId, index.revision);
      const located = yield* Effect.forEach(
        changed.roots,
        (root) =>
          root.state !== 'active'
            ? Effect.succeed({ root, fact: null })
            : Effect.map(standing(root, ancestors), (fact) => ({ root, fact })),
        { concurrency: 3 },
      );
      if (located.some(({ fact }) => fact === 'replaced')) continue;
      for (const { root, fact } of located) {
        if (fact === null || fact === 'replaced') index.remove(root.rootId);
        else index.add(root, fact);
      }
      index.revision = changed.revision;
      if (yield* unchanged(changed.revision)) return;
    }
  });

  const recheck = Effect.fn('FileRoots.recheck')(
    function* (admitted: RootFootprint, path: string = admitted.resource.path): Effect.fn.Return<RootFootprint, RootFailure> {
      if (admitted.resource.namespaceId !== namespaceId) {
        return yield* new RootRefused({
          namespaceId,
          path,
          reason: 'foreign-namespace',
          message: 'This footprint belongs to another filesystem namespace.',
        });
      }
      let footprint = admitted;
      for (;;) {
        const changed = yield* store.changesSince(namespaceId, footprint.registryRevision);
        const checked = yield* checkedAll(footprint.roots.map(({ root }) => root));
        const roots = new Map(checked.map((root) => [root.rootId, root]));
        for (const overlap of footprint.roots) {
          const current = yield* check(overlap.root);
          if (current.path !== overlap.resource.path) {
            return yield* new RootConflict({
              namespaceId,
              path,
              reason: 'resource-changed',
              message: 'A root moved after this command scope was resolved.',
            });
          }
        }
        const additions = changed.roots.filter((root) => root.state === 'active' && !roots.has(root.rootId));
        const ancestors = additions.length === 0 ? undefined : new Map<string, string>();
        const current = yield* probe(path, ancestors);
        if (!same(footprint.witness, current.witness) || current.path !== footprint.resource.path) {
          return yield* new RootConflict({
            namespaceId,
            path,
            reason: 'resource-changed',
            message: 'The admitted resource changed before use.',
          });
        }
        let replaced = false;
        for (const root of additions) {
          const found = yield* standing(root, ancestors ?? new Map());
          if (found === 'replaced') replaced = true;
          else if (
            found !== null &&
            (same(found.witness, current.witness) || found.ancestors.has(current.key) || current.ancestors.has(found.key))
          ) {
            return yield* new RootConflict({
              namespaceId,
              path,
              reason: 'resource-changed',
              message: 'A registration now overlaps a place this command scope already admitted.',
            });
          }
        }
        footprint = {
          ...footprint,
          registryRevision: changed.revision,
          roots: footprint.roots.map((overlap) => ({ ...overlap, root: roots.get(overlap.root.rootId)! })),
        };
        if (!replaced && (yield* unchanged(changed.revision))) return footprint;
      }
    },
    (work, admitted, _path?: string) => Effect.mapError(work, (error) => failure(error, admitted.resource.path)),
  );

  const retireMissing = Effect.fn('FileRoots.retireMissing')(
    function* (rootId: RootId, unit: WriteUnit<'machine'>): Effect.fn.Return<FileRoot, RootFailure> {
      const root = yield* checked(rootId, undefined, unit);
      const standing = yield* Effect.result(probe(root.path));
      if (standing._tag === 'Success') {
        return yield* new RootConflict({
          namespaceId,
          path: root.path,
          reason: 'resource-changed',
          message: 'The registered directory stands; a registration is retired only where its object is gone.',
        });
      }
      if (standing.failure._tag !== 'RootMissing') return yield* standing.failure;
      yield* store.retire(root, unit);
      return { ...root, state: 'retired' };
    },
    (work, rootId) => Effect.mapError(work, (error) => failure(error, undefined, rootId)),
  );

  const removed = Effect.fn('FileRoots.removed')(
    function* (rootId: RootId): Effect.fn.Return<boolean, RootFailure> {
      const root = yield* store.byId(rootId);
      if (root === null) return true;
      if (root.namespaceId !== namespaceId) return false;
      if (root.state !== 'active') return true;
      const standing = yield* Effect.result(check(root));
      if (standing._tag === 'Success') return false;
      const failure = standing.failure;
      if (failure._tag === 'RootConflict' && failure.reason === 'replaced') return true;
      if (failure._tag !== 'RootMissing') return yield* failure;
      return yield* unadministered(root);
    },
    (work, rootId) => Effect.mapError(work, (error) => failure(error, undefined, rootId)),
  );

  const unadministered = Effect.fn('FileRoots.unadministered')(function* (
    root: FileRoot,
  ): Effect.fn.Return<boolean, RootResolutionFailure> {
    const administration = root.git?.gitDirectory;
    if (administration === undefined || administration.namespaceId !== namespaceId) return false;
    const relation = paths.relative(root.path, administration.path);
    const outside = relation === '..' || relation.startsWith(`..${paths.sep}`) || paths.isAbsolute(relation);
    if (!outside) return false;
    const seen = yield* Effect.result(probe(administration.path));
    if (seen._tag === 'Success') return false;
    if (seen.failure._tag === 'RootMissing') return true;
    return yield* seen.failure;
  });

  const locate = Effect.fn('FileRoots.locate')(function* (
    root: FileRoot,
    path: string,
  ): Effect.fn.Return<ResourceAddress, RootResolutionFailure> {
    const fact = yield* probe(path);
    if (!same(root.witness, fact.witness)) {
      return yield* new RootConflict({
        namespaceId,
        path,
        reason: 'binding-mismatch',
        message: 'The requested location holds a different occupant than this registration.',
      });
    }
    return { namespaceId, path: fact.path };
  });

  const check = Effect.fn('FileRoots.check')(function* (
    root: FileRoot,
    ancestors?: Map<string, string>,
  ): Effect.fn.Return<DirectoryFact, RootFailure> {
    const fact = yield* probe(root.path, ancestors);
    if (!same(root.witness, fact.witness)) {
      yield* store.replaced(root);
      return yield* new RootConflict({ ...root, reason: 'replaced', message: 'The registered location holds a different occupant.' });
    }
    return fact;
  });

  const unchanged = (revision: number) => Effect.map(store.revision(namespaceId), (standing) => standing === revision);

  const probe = Effect.fn('FileRoots.probe')(function* (
    path: string,
    cache?: Map<string, string>,
  ): Effect.fn.Return<DirectoryFact, RootResolutionFailure> {
    if (!paths.isAbsolute(path)) {
      return yield* new RootInvalid({
        namespaceId,
        path,
        reason: 'relative-path',
        message: 'Resolution requires an absolute path in the supplied namespace.',
      });
    }
    const canonical = yield* io(files.realPath(path), path);
    const info = yield* io(files.stat(canonical), path);
    const { witness, key } = yield* witnessed(info, canonical);
    const ancestors = new Set<string>();
    if (cache !== undefined) {
      let parent = paths.dirname(canonical);
      while (parent !== canonical) {
        let identity = cache.get(parent);
        if (identity === undefined) {
          identity = yield* physicalKey(yield* io(files.stat(parent), parent), parent);
          cache.set(parent, identity);
        }
        ancestors.add(identity);
        const next = paths.dirname(parent);
        if (next === parent) break;
        parent = next;
      }
    }
    const checked = yield* witnessed(yield* io(files.stat(path), path), path);
    if (!same(witness, checked.witness)) {
      return yield* new RootConflict({
        namespaceId,
        path,
        reason: 'resource-changed',
        message: 'The resource changed while its identity was being checked.',
      });
    }
    return { path: canonical, type: info.type, witness, key, ancestors };
  });

  function witnessed(info: FileSystem.File.Info, path: string): Effect.Effect<{ key: string; witness: IdentityWitness }, RootUnavailable> {
    return Effect.flatMap(physicalKey(info, path), (key) => {
      const minted = witnessOf({
        type: info.type,
        inode: Option.getOrNull(info.ino),
        birthtime: Option.isNone(info.birthtime) ? null : info.birthtime.value.getTime(),
      });
      return Result.isFailure(minted)
        ? Effect.fail(
            new RootUnavailable({
              namespaceId,
              path,
              reason: 'identity-unavailable',
              message: 'The filesystem did not supply a usable birthtime identity witness.',
            }),
          )
        : Effect.succeed({ key, witness: minted.success });
    });
  }

  function physicalKey(info: FileSystem.File.Info, path: string): Effect.Effect<string, RootUnavailable> {
    const coordinate = coordinateOf({ type: info.type, device: info.dev, inode: Option.getOrNull(info.ino) });
    return Result.isFailure(coordinate)
      ? Effect.fail(
          new RootUnavailable({
            namespaceId,
            path,
            reason: 'identity-unavailable',
            message: 'The filesystem did not supply a usable device and inode.',
          }),
        )
      : Effect.succeed(coordinate.success);
  }

  function same(left: IdentityWitness, right: IdentityWitness): boolean {
    return sameWitness(left, right);
  }

  function failure(error: RootFailure, path?: string, rootId?: RootId): RootResolutionFailure {
    switch (error._tag) {
      case 'RootMissing':
      case 'RootUnavailable':
      case 'RootInvalid':
      case 'RootConflict':
      case 'RootRefused':
        return error;
      default:
        return storageUnavailable(namespaceId, error, path, rootId);
    }
  }

  function io<A>(work: Effect.Effect<A, import('effect/PlatformError').PlatformError>, path: string) {
    return Effect.mapError(work, (error) =>
      error.reason._tag === 'NotFound'
        ? new RootMissing({ namespaceId, path, message: error.message })
        : new RootUnavailable({ namespaceId, path, reason: 'filesystem', message: error.message }),
    );
  }

  return FileRoots.of({
    namespaceId,
    register,
    resolve,
    matching,
    relocate,
    publish,
    publishAll,
    read,
    checked,
    checkedAll,
    live,
    active,
    scope,
    resolveFootprint,
    recheck,
    retireMissing,
    removed,
    locate,
    probe,
  });
});
