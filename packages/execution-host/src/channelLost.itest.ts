import { afterAll, describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Context, Deferred, Effect, Layer } from 'effect';
import type { HolderLoss } from '@runlith/executions/protocol/runtime';
import { Bindings } from './Bindings';
import { ExecutionCapacity } from './ExecutionCapacity';
import { Holder } from './holder/Holder';
import { hostProfile, registrationOf, stateDirectories } from './hostFixture';
import { hostSpawner } from './hostSpawner';
import { hostState } from './hostState';
import type { PlatformFacts } from './PlatformFacts';
import type { ProcessControl } from './ProcessControl';
import type { Processes } from './ProcessReader';
import type { ProcessTempo } from './ProcessTempo';
import { testHolder } from './posix/testing/holder';
import { ExecutionRegistry } from './registry/ExecutionRegistry';
import { HostLifecycle } from './registry/shutdown';

const directories = stateDirectories('channel-lost-');
afterAll(directories.clear);

const breaking = (directory: string, broke: Deferred.Deferred<HolderLoss>) =>
  Layer.effectContext(
    Effect.map(Effect.context<Holder | Processes | ProcessControl | PlatformFacts | ProcessTempo>(), (context) => {
      const held = Context.get(context, Holder);
      return Context.add(context, Holder, { ...held, lost: Effect.raceFirst(held.lost, Deferred.await(broke)) });
    }),
  ).pipe(Layer.provide(testHolder(directory)));

const host = (directory: string, broke: Deferred.Deferred<HolderLoss>) =>
  ExecutionRegistry.layer().pipe(
    Layer.provideMerge(Bindings.layer),
    Layer.provideMerge(
      Layer.unwrap(Effect.map(sharedPool, (pool) => hostState(`${directory}/executions.sqlite`, registrationOf(directory), pool))).pipe(
        Layer.provideMerge(ExecutionCapacity.layer(hostProfile({ executions: 2 }))),
      ),
    ),
    Layer.provide(breaking(directory, broke)),
    Layer.provideMerge(hostSpawner),
    Layer.provide(BunFileSystem.layer),
    Layer.provide(BunPath.layer),
  );

describe('a logic whose channel to its holder broke', () => {
  it.live('leaves its place by itself, permitting no candidate when none stands', () =>
    Effect.gen(function* () {
      const broke = yield* Deferred.make<HolderLoss>();
      const permitted = yield* Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* HostLifecycle;
          yield* Effect.forkScoped(lifecycle.orphaned);
          yield* Deferred.succeed(broke, { reason: 'broken', detail: 'the holder sent a frame this logic cannot read' } as const);
          return yield* lifecycle.departed.pipe(Effect.timeout(10_000));
        }).pipe(Effect.provide(host(directories.open(), broke))),
      );
      expect(permitted).toBe(false);
    }),
  );
});
