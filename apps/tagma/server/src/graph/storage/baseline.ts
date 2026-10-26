import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Handover } from '@runlith/sqlite-process/SqliteProcess';
import { Context, Effect, Exit, Layer, Scope } from 'effect';
import { GraphStore, MachineStore, type MigrationChain } from '../../platform/contract/service/store.js';
import { storeLayer } from '../../platform/store/open.js';
import { removeMirror } from './layout.js';

export const mirrorStoreLayer = (path: string, migrations: MigrationChain<'graph'>) =>
  Layer.effect(
    GraphStore,
    Effect.gen(function* () {
      const parent = yield* Effect.scope;
      const { processes, durable } = yield* MachineStore;
      const handover = yield* Handover;
      const open = Effect.fnUntraced(function* () {
        const scope = yield* Scope.fork(parent);
        return yield* Layer.buildWithScope(
          storeLayer(GraphStore, path, migrations, { durable }, processes).pipe(Layer.provide(Layer.succeed(Handover, handover))),
          scope,
        ).pipe(Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))));
      });
      const context = yield* open().pipe(
        Effect.catchTag('BaselineNotReached', (failure) =>
          Effect.gen(function* () {
            yield* removeMirror(path);
            yield* Effect.logInfo('a mirror below the baseline cut is rebuilt from its tree', { path, reason: failure.message });
            return yield* open();
          }),
        ),
      );
      return Context.get(context, GraphStore);
    }),
  ).pipe(Layer.provide(BunFileSystem.layer));
