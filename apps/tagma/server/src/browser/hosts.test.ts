import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber, Scope } from 'effect';
import type { Host } from './contract/service/hosts.js';
import { makeHosts } from './hosts.js';

const unused = () => Effect.die('this test reaches the host registry only');
const host: Host = {
  id: 'desktop',
  adapter: 'desktop',
  pid: null,
  native: true,
  pages: {
    open: unused,
    adopt: unused,
    close: unused,
    live: unused(),
    navigate: unused,
    pdf: unused,
    answer: unused,
    events: unused(),
    paint: unused,
    session: unused,
  },
  profiles: { prepare: unused, session: unused, remove: unused },
  capture: null,
};

it.effect('a reach during host attachment waits for its observers before returning the connected host', () =>
  Effect.gen(function* () {
    const hosts = yield* makeHosts;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* hosts.watch({
      attached: () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
      detached: () => Effect.void,
    });
    const attaching = yield* Effect.forkChild(hosts.attach(host));
    yield* Deferred.await(entered);
    const reached = yield* Effect.forkChild(hosts.reach('desktop'), { startImmediately: true });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(attaching);
    expect(yield* Fiber.join(reached)).toBe(host);
  }),
);

it.effect('a reach is refused when the scope of the host still attaching closes', () =>
  Effect.gen(function* () {
    const hosts = yield* makeHosts;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    yield* hosts.watch({
      attached: () => Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
      detached: () => Effect.void,
    });
    const life = yield* Scope.fork(yield* Effect.scope);
    yield* Effect.forkIn(Scope.provide(hosts.attach(host), life), life);
    yield* Deferred.await(entered);
    const reached = yield* Effect.forkChild(Effect.result(hosts.reach('desktop')), { startImmediately: true });
    const closing = yield* Effect.forkChild(Scope.close(life, Exit.void), { startImmediately: true });
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(closing);
    const answer = yield* Fiber.join(reached);
    expect(answer._tag).toBe('Failure');
    if (answer._tag === 'Failure') expect(answer.failure.adapter).toBe('desktop');
    expect(hosts.connected('desktop')).toBeUndefined();
  }),
);
