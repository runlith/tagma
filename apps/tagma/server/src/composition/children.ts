import { Effect, type FileSystem, Layer, type Scope } from 'effect';
import { join } from 'node:path';
import { Processes } from '@runlith/execution-host/ProcessReader';
import { processLayer, yieldAsker } from '@runlith/execution-host/composition/platform';
import { pathOf, readArtifact } from '@runlith/executions/hostArtifacts';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { ChildLedger, childLedger } from '../platform/contract/service/children.js';
import { LogicYield } from '../executions/contract/service/host.js';

type PlatformLibrary = { readonly _tag: 'Found'; readonly path: string } | { readonly _tag: 'Unavailable'; readonly detail: string };

const platformLibrary = Effect.fnUntraced(function* (
  checkout: string | undefined,
  bundle: string | undefined,
): Effect.fn.Return<PlatformLibrary, never, FileSystem.FileSystem> {
  if (bundle !== undefined) {
    const read = yield* Effect.result(readArtifact(bundle));
    if (read._tag === 'Failure')
      return {
        _tag: 'Unavailable',
        detail: read.failure._tag === 'ArtifactMissing' ? `no process-reader artifact at ${bundle}` : read.failure.detail,
      };
    if (read.success.platform.os !== process.platform || read.success.platform.arch !== process.arch)
      return { _tag: 'Unavailable', detail: 'the process-reader artifact belongs to another platform' };
    const path = pathOf(bundle, read.success, 'platform');
    return path === undefined ? { _tag: 'Unavailable', detail: `${bundle} names no platform library` } : { _tag: 'Found', path };
  }
  if (checkout !== undefined) return { _tag: 'Found', path: join(checkout, 'native', 'target', 'release', 'libexecution_platform.dylib') };
  return { _tag: 'Unavailable', detail: 'this world has no process-reader artifact' };
});

export const childLedgerLayer = (checkout: string | undefined, bundle: string | undefined): Layer.Layer<never> => {
  const unavailable = (detail: string) =>
    Layer.effect(
      ChildLedger,
      Effect.as(
        Effect.logWarning('server child attribution is unavailable: no native process reader', { detail }),
        childLedger(undefined, detail),
      ),
    );
  return Layer.unwrap(
    Effect.map(platformLibrary(checkout, bundle), (library) =>
      library._tag === 'Unavailable'
        ? unavailable(library.detail)
        : Layer.effect(
            ChildLedger,
            Effect.map(Processes, (reader) => childLedger(reader)),
          ).pipe(
            Layer.provide(processLayer(library.path)),
            Layer.catchTag('BootRefused', (refused) => unavailable(refused.detail)),
          ),
    ),
  ).pipe(Layer.provide(BunFileSystem.layer));
};

export const logicYieldLayer = (checkout: string | undefined, bundle: string | undefined): Layer.Layer<LogicYield> =>
  Layer.effect(
    LogicYield,
    Effect.gen(function* (): Effect.fn.Return<LogicYield['Service'], never, Scope.Scope | FileSystem.FileSystem> {
      const library = yield* platformLibrary(checkout, bundle);
      if (library._tag === 'Unavailable') return { ask: () => Effect.succeed({ _tag: 'Unasked', detail: library.detail } as const) };
      const asker = yield* Effect.result(yieldAsker(library.path));
      if (asker._tag === 'Failure') return { ask: () => Effect.succeed({ _tag: 'Unasked', detail: asker.failure.detail } as const) };
      const ask = asker.success;
      return {
        ask: (logic) =>
          Effect.map(ask(logic), (delivery) =>
            delivery === 'delivered'
              ? ({ _tag: 'Asked' } as const)
              : delivery === 'gone' || delivery === 'changed'
                ? ({ _tag: 'Gone' } as const)
                : ({ _tag: 'Unasked', detail: `the signal to logic ${logic.pid} was not delivered: it is ${delivery}` } as const),
          ),
      };
    }),
  ).pipe(Layer.provide(BunFileSystem.layer));
