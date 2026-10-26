import { Context, Effect, Layer, Scope } from 'effect';
import type { ThreadResourceLedgerFactory, ThreadResourceLedgerHarness } from '@runlith/agent/thread/conformance/resources';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { openThreadStore } from './storageHarness.js';

type Storage = ThreadResourceLedgerHarness<Unit<'machine'>, WriteUnit<'machine'>>;

export class FileThreadStorage extends Context.Service<
  FileThreadStorage,
  {
    readonly open: ThreadResourceLedgerFactory<Unit<'machine'>, WriteUnit<'machine'>>;
  }
>()('tagma/testing/FileThreadStorage') {}

export const fileThreadStorage = Layer.effect(
  FileThreadStorage,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    let store = yield* openThreadStore();
    const current = (): Storage => ({
      ...store.storage,
      reopen: Effect.fnUntraced(function* () {
        store = yield* store.reopen().pipe(Effect.provideService(Scope.Scope, scope));
        return current();
      }),
      dispose: () => Effect.void,
    });
    return FileThreadStorage.of({
      open: Effect.fnUntraced(function* () {
        yield* store.reset();
        return current();
      }),
    });
  }),
);

export const openFileThreadStorage = () => Effect.flatMap(FileThreadStorage, (storage) => storage.open());
