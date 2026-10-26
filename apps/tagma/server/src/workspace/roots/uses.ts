import { sep } from 'node:path';
import { Effect } from 'effect';
import { uuidv7 } from 'uuidv7';
import { LocationRevision } from '@runlith/files/resource';
import { MachineUnits, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { fileRoot, fileRootNamespace } from '../store/tables.js';
import { UseId, type RootId } from '../contract/wire/ids.js';
import { RootConflict, RootRefused, type FileRoot, type RootBinding } from '../contract/wire/roots.js';
import {
  RootUseLost,
  RootUseMissing,
  RootUseRefused,
  type RootUse,
  type RootUseFailure,
  type UseConsumer,
  type UseHolder,
  type UseMode,
  type RootUseInput,
  type RootUseSettlementInput,
} from '../contract/wire/uses.js';
import { storageUnavailable, type FileRootStore, type RootStoreFailure } from '../store/rootRegistry.js';
import { FileRoots, RootUses } from '../contract/service/roots.js';
import type { RootUseStore } from '../store/uses.js';

type UseFailure = RootUseFailure | RootStoreFailure;

export type RootUseLedger = RootUses['Service'];

export const makeRootUseLedger = Effect.fnUntraced(function* ({
  uses,
  records,
}: {
  readonly uses: RootUseStore;
  readonly records: FileRootStore;
}) {
  const roots = yield* FileRoots;
  const units = yield* MachineUnits;

  const reserve = Effect.fn('RootUses.reserve')(
    function* (unit: WriteUnit<'machine'>, request: RootUseInput): Effect.fn.Return<RootUse, UseFailure> {
      const { footprint, consumer, mode } = request;
      const namespaceId = roots.namespaceId;
      const path = footprint.resource.path;
      if (footprint.resource.namespaceId !== namespaceId) {
        return yield* new RootRefused({
          namespaceId,
          path,
          reason: 'foreign-namespace',
          message: `This footprint was resolved in ${footprint.resource.namespaceId}, and this ledger holds ${namespaceId}.`,
        });
      }
      const bindings = footprint.roots
        .filter((overlap) => mode === 'disruptive' || overlap.relation !== 'descendant')
        .map((overlap) => ({
          rootId: overlap.root.rootId,
          locationRevision: overlap.root.locationRevision,
        }));
      const checked = yield* roots.checkedAll(bindings, unit);
      if ((yield* records.revision(namespaceId, unit)) !== footprint.registryRevision) {
        return yield* new RootConflict({
          namespaceId,
          path,
          reason: 'registry-changed',
          message: 'The root registry changed after this footprint was resolved.',
        });
      }
      const refusing = mode === 'disruptive' ? yield* standing(checked, unit) : yield* standing(checked, unit, 'disruptive');
      if (refusing.length > 0) {
        return yield* new RootUseRefused({
          namespaceId,
          path,
          uses: refusing,
          message: 'A disruptive use excludes every other use of the roots it holds.',
        });
      }
      const use = {
        useId: UseId.make(uuidv7()),
        resource: footprint.resource,
        consumer,
        mode,
        state: 'held' as const,
        roots: bindings.sort((one, next) => (one.rootId < next.rootId ? -1 : 1)),
      };
      yield* uses.hold(use, unit);
      return use;
    },
    (work, _unit, request) => Effect.mapError(work, (error) => failure(error, request.footprint.resource.path)),
  );

  const release = Effect.fn('RootUses.release')(
    function* (unit: WriteUnit<'machine'>, resolution: RootUseSettlementInput): Effect.fn.Return<RootUse, UseFailure> {
      const use = yield* uses.byId(resolution.useId, unit);
      if (use === null || use.resource.namespaceId !== roots.namespaceId || !holds(use, resolution.consumer)) {
        return yield* new RootUseMissing({
          useId: resolution.useId,
          message: 'This consumer holds no receipt with that identity.',
        });
      }
      if (use.state === 'released') return use;
      if (resolution.outcome === 'uncertain') {
        return yield* new RootUseLost({
          useId: use.useId,
          message: 'An unresolved consumer outcome keeps its reservation standing.',
        });
      }
      yield* uses.release(use.useId, unit);
      return { ...use, state: 'released' };
    },
    (work) => Effect.mapError(work, (error) => failure(error)),
  );

  const forget = Effect.fn('RootUses.forget')(
    function* (unit: WriteUnit<'machine'>, under: UseHolder | null, binding: RootBinding): Effect.fn.Return<FileRoot, UseFailure> {
      const root = yield* admit(under, binding, unit);
      yield* records.retire(root, unit);
      return { ...root, state: 'retired' as const };
    },
    (work, _unit, _under, binding) => Effect.mapError(work, (error) => failure(error, undefined, binding.rootId)),
  );

  const relocate = Effect.fn('RootUses.relocate')(
    function* (under: UseHolder | null, binding: RootBinding, path: string): Effect.fn.Return<FileRoot, UseFailure> {
      const admitted = yield* units.write(writes('RootUses.admitted', []), (unit) => admit(under, binding, unit));
      const resource = yield* roots.locate(admitted, path);
      return yield* units.write(
        writes('RootUses.relocate', [fileRoot, fileRootNamespace]),
        Effect.fnUntraced(function* (unit) {
          const root = yield* admit(under, binding, unit);
          const claimants = (yield* records.candidates(root.namespaceId, resource.path, root.witness, unit)).filter(
            (other) => other.rootId !== root.rootId,
          );
          const standing = yield* uses.holders(
            claimants.map((claimant) => claimant.rootId),
            unit,
          );
          if (standing.length > 0) {
            return yield* new RootUseRefused({
              namespaceId: root.namespaceId,
              path: resource.path,
              uses: standing,
              message: 'Uses hold the registration this location change would retire.',
            });
          }
          for (const claimant of claimants) yield* records.condemn(claimant, unit);
          if (root.locationRevision === Number.MAX_SAFE_INTEGER) {
            return yield* new RootRefused({
              namespaceId: root.namespaceId,
              path: root.path,
              reason: 'revision-exhausted',
              message: 'The location revision counter is exhausted.',
            });
          }
          const moved = {
            ...root,
            path: resource.path,
            locationRevision: LocationRevision.make(root.locationRevision + 1),
          };
          yield* records.relocate(moved, unit);
          return moved;
        }),
      );
    },
    (work, _under, binding, path) => Effect.mapError(work, (error) => failure(error, path, binding.rootId)),
  );

  const admit = Effect.fn('RootUses.admit')(function* (
    under: UseHolder | null,
    binding: RootBinding,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<FileRoot, UseFailure> {
    const root = yield* roots.checked(binding.rootId, binding.locationRevision, unit);
    const held = yield* standing([root], unit);
    const refusing = held.filter(
      (use) => under === null || use.useId !== under.useId || use.mode !== 'disruptive' || !holds(use, under.consumer),
    );
    if (refusing.length > 0) {
      return yield* new RootUseRefused({
        namespaceId: root.namespaceId,
        path: root.path,
        uses: refusing,
        message: 'Uses that do not admit this change hold this root.',
      });
    }
    if (under !== null && held.length === 0) {
      return yield* new RootUseMissing({
        useId: under.useId,
        message: 'This consumer holds no disruptive use of this root.',
      });
    }
    return root;
  });

  const holding = Effect.fn('RootUses.holding')(
    function* (unit: Unit<'machine'>, rootIds: readonly RootId[]) {
      return yield* standing(yield* records.byIds(rootIds, unit), unit);
    },
    (work) => Effect.mapError(work, (error) => failure(error)),
  );

  const standing = Effect.fn('RootUses.standing')(function* (
    registrations: readonly FileRoot[],
    unit: Unit<'machine'>,
    mode?: UseMode,
  ): Effect.fn.Return<readonly RootUse[], UseFailure> {
    const identities = yield* records.identities(
      roots.namespaceId,
      registrations.map((root) => root.witness),
      unit,
    );
    const held = yield* uses.holders(identities, unit, mode);
    return held.filter((use) => use.mode === 'disruptive' || registrations.some((root) => within(root.path, use.resource.path)));
  });

  function within(root: string, path: string): boolean {
    return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  }

  function holds(use: RootUse, consumer: UseConsumer): boolean {
    return use.consumer.kind === consumer.kind && use.consumer.id === consumer.id;
  }

  function failure(error: UseFailure, path?: string, rootId?: RootId): RootUseFailure {
    switch (error._tag) {
      case 'RootMissing':
      case 'RootUnavailable':
      case 'RootInvalid':
      case 'RootConflict':
      case 'RootRefused':
      case 'RootUseMissing':
      case 'RootUseRefused':
      case 'RootUseLost':
        return error;
      default:
        return storageUnavailable(roots.namespaceId, error, path, rootId);
    }
  }

  return RootUses.of({ reserve, release, forget, relocate, holding });
});
