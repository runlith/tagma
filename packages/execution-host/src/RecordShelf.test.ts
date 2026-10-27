import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FileSystem, Path } from 'effect';
import { ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import { makeRecordShelf } from './RecordShelf';
import { ExecutionStore } from './store/ExecutionStore';
import { unreadStore } from './testing/store';

it.live(
  'interrupting a release before its read fence resolves releases the wait for a sealed record',
  Effect.fnUntraced(function* () {
    const installation = InstallationId.make('installation');
    const execution = ExecutionId.make('command');
    const shelf = yield* makeRecordShelf({
      current: {
        installation,
        incarnation: 1,
        phase: 'open',
        registration: {
          version: 1,
          installation,
          state: '/state',
          protocol: 'executions/1',
          endpoint: { transport: 'unix', path: '/state/host.sock' },
          credentials: { custodian: '/state/custodian', recovery: '/state/recovery' },
        },
      },
      records: '/records',
      chunkBytes: 1,
      pipeModes: { _tag: 'Unavailable', revision: 0, reason: 'pipes' },
      volumeOf: () => Effect.die('the release did not enter shelving'),
      retired: () => {},
      live: () => false,
      inventoryWoken: Effect.void,
    }).pipe(
      Effect.provideService(
        ExecutionStore,
        ExecutionStore.of({
          ...unreadStore,
          retiredLedger: () => Effect.succeed([]),
          shelfLedger: () => Effect.succeed({ bytes: 0, through: undefined }),
        }),
      ),
      Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({})),
      Effect.provide(Path.layer),
    );
    const fencing = yield* Deferred.make<void>();
    const release = yield* Effect.forkScoped(
      shelf.release(
        execution,
        Effect.andThen(Deferred.succeed(fencing, undefined), Effect.never),
        Effect.die('the release did not enter sealing'),
        Effect.void,
      ),
    );
    yield* Deferred.await(fencing);
    yield* Fiber.interrupt(release);
    expect(yield* shelf.sealed(execution)).toBe(false);
  }),
);
