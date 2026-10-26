import { Context, Effect, Exit, Layer, Semaphore, Tracer } from 'effect';
import { GraphStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { session } from '../../platform/store/writers.js';
import { SignedCall, SignedSession } from '../../platform/contract/service/writers.js';
import { block, blockField, blockTag, event, meta, ref, searchIndex } from '../store/tables.js';
import { setting } from '../../settings/store/table.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { CatalogInstall, Tags } from '../contract/service/vocabulary.js';
import { Act, BlockNames, BlockProjection, BlockReferences, CommitEffects } from '../contract/service/acts.js';
import { BlockRows } from '../acts/rows.js';
import { ActState } from '../contract/service/transaction.js';
import { unitState, withUnit } from '../acts/state.js';
import { Behaviours } from '../contract/service/behaviours.js';
import type { FloorRefusal, GateRefusal, OpenRefusal } from '../../platform/contract/wire/refusal.js';
import { ManagedWrite } from '../../settings/contract/service/managed.js';
import type { ManagedWriteInput } from '../../settings/contract/service/managed.js';
import { projecting, referencing } from '../store/actWrites.js';
import { guardedInstall, installCatalogs, type InstallRefusal, installRoad } from './activation.js';
import type { CatalogCandidate } from './candidate.js';
import { projectTypeIds } from './typeProjection.js';

const settingsPlusCatalogs = writes('settings', [block, blockField, blockTag, event, meta, ref, searchIndex, session, setting]);
const installing = writes('Catalog.install', [block], projecting, referencing);

export type CatalogWriter = (
  catalogIds: readonly string[],
) => Effect.Effect<void, StoreFailure | GateRefusal<FloorRefusal | InstallRefusal>>;

type InstallServices = GraphStore | Act | BlockRows | BlockNames | BlockProjection | BlockReferences | Catalogs | Behaviours | Tags;

export const catalogWriter = Effect.fn('Catalog.writer')(function* (
  context: Context.Context<InstallServices>,
  projectId: number,
): Effect.fn.Return<CatalogWriter> {
  const call = Context.addOrOmit(
    Context.add(Context.add(context, SignedSession, yield* SignedSession), SignedCall, yield* SignedCall),
    Tracer.ParentSpan,
    yield* Effect.serviceOption(Tracer.ParentSpan),
  );
  return (catalogIds) =>
    Effect.setContext(
      Effect.gen(function* () {
        const road = yield* installRoad;
        yield* guardedInstall(road, projectId, catalogIds, (candidate) =>
          candidate === null
            ? Effect.void
            : road.act.unit(installing, Effect.asVoid(installCatalogs(road, projectId, catalogIds, candidate))),
        );
      }),
      call,
    );
});

export const CatalogGraph = Context.Reference<((projectId: number) => Effect.Effect<CatalogWriter, GateRefusal<OpenRefusal>>) | null>(
  'tagma/graph/CatalogGraph',
  { defaultValue: () => null },
);

export const catalogInstallLayer = (registers: boolean): Layer.Layer<CatalogInstall, never, ManagedWrite | InstallServices> =>
  Layer.effect(
    CatalogInstall,
    Effect.gen(function* () {
      const managed = yield* ManagedWrite;
      const store = yield* GraphStore;
      const road = yield* installRoad;
      const writes = Semaphore.makeUnsafe(1);
      const transaction = Effect.fnUntraced(function* (input: ManagedWriteInput<readonly string[]>, candidate: CatalogCandidate | null) {
        const held = unitState();
        return yield* store.transaction(
          settingsPlusCatalogs,
          (unit) =>
            Effect.provideService(
              Effect.gen(function* () {
                const written = yield* managed.write(unit, input);
                if (input.projectId !== null && candidate !== null)
                  yield* installCatalogs(road, input.projectId, input.resolved, candidate);
                yield* projectTypeIds(store.db, road.tags);
                return written;
              }),
              ActState,
              withUnit(held, unit),
            ),
          {
            onCommit: Effect.fnUntraced(function* (written) {
              yield* road.tags.publish(held);
              for (const hook of yield* CommitEffects) yield* hook;
              yield* written.announce;
            }),
          },
        );
      });
      const install = CatalogInstall.of({
        write: (input) =>
          writes.withPermits(1)(
            Effect.gen(function* () {
              const projectId = input.projectId;
              const catalogGraph = projectId === null ? null : yield* CatalogGraph;
              const writer = catalogGraph === null || projectId === null ? null : yield* catalogGraph(projectId);
              if (writer !== null) yield* writer(input.resolved);
              if (projectId === null || writer !== null) return yield* transaction(input, null);
              yield* guardedInstall(road, projectId, input.resolved, (candidate) => transaction(input, candidate));
            }),
          ),
      });
      if (registers && road.shipped.key !== null) yield* managed.register(road.shipped.key, (input) => install.write(input));
      return install;
    }),
  );
