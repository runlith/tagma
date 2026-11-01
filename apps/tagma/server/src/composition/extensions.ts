import type { AudioDevices } from '@runlith/audio/port/devices';
import type { Speech } from '@runlith/speech/engine/Speech';
import { Context, Effect, Layer, Scope } from 'effect';
import { watched } from '../platform/contract/service/drives.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import type { ProjectChanges } from '../projects/contract/service/changes.js';
import type { Projects } from '../projects/contract/service/registry.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { Captures } from '../speech/contract/service/captures.js';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { type OwnStore, ownStorePath, setAsidePath } from '../platform/contract/service/ownStore.js';
import { IN_MEMORY, MachineStore } from '../platform/contract/service/store.js';
import { storeLayer } from '../platform/store/open.js';
import { ownStoreChain } from '../installation/closure/read.js';
import { CORE_MODULES } from './core.js';

const CORE: ReadonlySet<Manifest> = new Set(CORE_MODULES);

export type ExtensionOwners = Settings | Projects | ProjectChanges | Maintenance | Speech | AudioDevices | Captures;

type ExtensionLayer = Layer.Layer<never, unknown, any>;

type Tier = 'installation' | 'serving';

const extending = (modules: readonly Manifest[], tier: Tier): ExtensionLayer[] =>
  modules.flatMap((module) => (CORE.has(module) ? [] : ((module.lifetimes?.[tier] as ExtensionLayer | undefined) ?? [])));

const adopting = (store: OwnStore, machine: MachineStore['Service']) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const { opened } = yield* Maintenance;
      const own = yield* store.key;
      const adopt = Effect.fnUntraced(function* (migration: string) {
        const adopted = yield* own.adopt(setAsidePath(machine.path, migration));
        if (adopted.outcome === 'adopted')
          console.log(`[tagma] the ${store.id} store adopted the set-aside of ${migration}: ${adopted.rows} rows`);
      });
      yield* Effect.forkScoped(watched(`${store.id}/adopt`, Effect.andThen(opened, Effect.forEach(store.adopts ?? [], adopt))));
    }),
  );

const ownStores = (modules: readonly Manifest[], machine: MachineStore['Service'], seeds: string): ExtensionLayer =>
  Layer.mergeAll(
    Layer.empty,
    ...modules.flatMap((module) =>
      (module.stores ?? []).map((store) => {
        const opened = storeLayer(
          store.key,
          ownStorePath(machine.path, store.id),
          { folder: ownStoreChain(store), seeds },
          { durable: machine.durable },
          machine.processes,
        );
        return store.adopts === undefined || machine.path === IN_MEMORY
          ? opened
          : adopting(store, machine).pipe(Layer.provideMerge(opened));
      }),
    ),
  );

const built = <R>(layer: ExtensionLayer, over: Context.Context<R>, scope: Scope.Scope): Effect.Effect<Context.Context<never>> =>
  Scope.provide(Layer.build(layer.pipe(Layer.provide(Layer.succeedContext(over as Context.Context<any>)))), scope).pipe(Effect.orDie);

export const installedIn = Effect.fn('composition.installedIn')(function* <R>(
  modules: readonly Manifest[],
  over: Context.Context<R | MachineStore>,
  seeds: string,
  scope: Scope.Scope,
) {
  const stores = ownStores(modules, Context.get(over, MachineStore), seeds);
  return yield* built(Layer.mergeAll(Layer.empty, ...extending(modules, 'installation')).pipe(Layer.provideMerge(stores)), over, scope);
});

export const servedIn = Effect.fn('composition.servedIn')(function* <R>(
  modules: readonly Manifest[],
  over: Context.Context<R>,
  scope: Scope.Scope,
) {
  return yield* built(Layer.mergeAll(Layer.empty, ...extending(modules, 'serving')), over, scope);
});
