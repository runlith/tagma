import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, Exit } from 'effect';
import { WireUnavailable, type ExecutionsFailure } from '@runlith/executions/Executions';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import { CHECKOUT_WORLD_KIND } from '../contract/service/worlds.js';
import type { HostConnection } from '../host/connection.js';
import { checkoutWorldFor, type CheckoutWorldServices } from './managed.js';
import { makeMachineWorld } from './machine.js';

const installation = InstallationId.make('world-door');

const standing = (holder: RuntimeStatus['holder']): RuntimeStatus =>
  ({ installation, incarnation: 3, phase: 'open', holder, custody: { revision: 0, epoch: 0 } }) as unknown as RuntimeStatus;

const gone: RuntimeStatus['holder'] = { _tag: 'Lost', loss: { reason: 'gone', detail: 'the holder closed its end of the channel' } };

const unreachable: ExecutionsFailure = new WireUnavailable({ kind: 'unreachable', reason: 'connect ENOENT', sent: false });

const door = (status: Effect.Effect<RuntimeStatus, ExecutionsFailure>, raised: boolean) => {
  let asked = 0;
  let resolved = 0;
  const deps = {
    preferences: { checkout: () => Effect.succeed('managed' as const) },
    host: { installation, port: { status: () => status } } as unknown as HostConnection,
    successor: Effect.sync(() => {
      asked += 1;
      return raised;
    }),
    targets: {
      resolve: () =>
        Effect.suspend(() => {
          resolved += 1;
          return Effect.fail({ _tag: 'TargetUnresolved' as const });
        }),
    },
    scratch: (threadId: string) => `/scratch/${threadId}`,
    world: makeMachineWorld(() => null),
  } as unknown as CheckoutWorldServices;
  const world = Effect.scoped(
    checkoutWorldFor({ id: 'thread-1', hostKind: null, hostId: null }, '/checkout', 1, 'run-1', () => Effect.die('unleased'), deps),
  );
  return { world, asked: () => asked, resolved: () => resolved };
};

it.effect('a thread whose host is gone works in the platform world only after no successor came up', () =>
  Effect.gen(function* () {
    const selection = door(Effect.fail(unreachable), false);
    const world = yield* selection.world;
    expect(world.kind).toBe(CHECKOUT_WORLD_KIND);
    expect(selection.asked()).toBe(1);
    expect(selection.resolved()).toBe(0);
  }),
);

it.effect('a thread whose host is gone takes the managed world once a successor came up', () =>
  Effect.gen(function* () {
    const selection = door(Effect.fail(unreachable), true);
    const exit = yield* Effect.exit(selection.world);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(selection.asked()).toBe(1);
    expect(selection.resolved()).toBe(1);
  }),
);

it.effect('a host whose holder is gone is replaced before the thread is given a world', () =>
  Effect.gen(function* () {
    const selection = door(Effect.succeed(standing(gone)), true);
    yield* Effect.exit(selection.world);
    expect(selection.asked()).toBe(1);
    expect(selection.resolved()).toBe(1);
  }),
);

it.effect('a host that admits work is used as it stands, without asking for a successor', () =>
  Effect.gen(function* () {
    const selection = door(Effect.succeed(standing({ _tag: 'Standing' })), false);
    yield* Effect.exit(selection.world);
    expect(selection.asked()).toBe(0);
    expect(selection.resolved()).toBe(1);
  }),
);
