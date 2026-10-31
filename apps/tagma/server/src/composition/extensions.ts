import { type Context, Effect, Layer, Scope } from 'effect';
import type { Manifest } from '../platform/contract/service/manifest.js';
import { CORE_MODULES } from './core.js';

const CORE: ReadonlySet<Manifest> = new Set(CORE_MODULES);

type ExtensionLayer = Layer.Layer<never, unknown, any>;

type Tier = 'installation' | 'serving';

export const standsIn = Effect.fnUntraced(function* <R>(
  modules: readonly Manifest[],
  tier: Tier,
  over: Context.Context<R>,
  scope: Scope.Scope,
) {
  const layers = modules.flatMap((module) => (CORE.has(module) ? [] : ((module.lifetimes?.[tier] as ExtensionLayer | undefined) ?? [])));
  const built: Context.Context<never> = yield* Scope.provide(
    Layer.build(Layer.mergeAll(Layer.empty, ...layers).pipe(Layer.provide(Layer.succeedContext(over as Context.Context<any>)))),
    scope,
  ).pipe(Effect.orDie);
  return built;
});
