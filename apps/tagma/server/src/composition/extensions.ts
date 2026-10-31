import { Context, Effect, Layer, Scope } from 'effect';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { ownStorePath } from '../platform/contract/service/ownStore.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { storeLayer } from '../platform/store/open.js';
import { ownStoreChain } from '../installation/closure/read.js';
import { CORE_MODULES } from './core.js';

const CORE: ReadonlySet<Manifest> = new Set(CORE_MODULES);

type ExtensionLayer = Layer.Layer<never, unknown, any>;

type Tier = 'installation' | 'serving';

const extending = (modules: readonly Manifest[], tier: Tier): ExtensionLayer[] =>
  modules.flatMap((module) => (CORE.has(module) ? [] : ((module.lifetimes?.[tier] as ExtensionLayer | undefined) ?? [])));

const ownStores = (modules: readonly Manifest[], machine: MachineStore['Service'], seeds: string): ExtensionLayer =>
  Layer.mergeAll(
    Layer.empty,
    ...modules.flatMap((module) =>
      (module.stores ?? []).map((store) =>
        storeLayer(
          store.key,
          ownStorePath(machine.path, store.id),
          { folder: ownStoreChain(store), seeds },
          { durable: machine.durable },
          machine.processes,
        ),
      ),
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
