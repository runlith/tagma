import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { machineWorld } from '@runlith/agent-tools/world/machine';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { WorkspaceGeneration } from '../../workspace/contract/wire/ids.js';
import type { ProvedRoot, TargetAt } from '../../workspace/contract/wire/place.js';
import { checkoutWorld } from './checkout.js';
import { makeMachineWorld } from './machine.js';
import { Worlds, type ThreadWorld, type WorldLease } from '../contract/service/worlds.js';
import { makeLeasedWorlds } from './cache.js';

it.effect('closing the worlds layer cuts a hung opening and releases what it had opened', () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let finalized = false;
    const hung = {
      kind: 'sandbox',
      world: Effect.fnUntraced(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            finalized = true;
          }),
        );
        yield* Deferred.succeed(entered, undefined);
        return yield* Effect.never;
      }),
    };
    const owner = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(Layer.effect(Worlds, makeLeasedWorlds({ checkout, hosts: [hung], place })), owner);
    const asked = yield* Effect.forkChild(Context.get(context, Worlds).of(asking(bound, 0)));
    yield* Deferred.await(entered);
    yield* Scope.close(owner, Exit.void);
    expect(finalized).toBe(true);
    const exit = yield* Fiber.await(asked);
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
  }),
);

const guest = (alive: () => boolean): ThreadWorld => ({
  kind: 'sandbox',
  facts: { shared: false, history: false, network: false },
  world: { files: machineWorld.files, environment: { ...machineWorld.environment, platform: 'linux' } },
  root: '/work',
  scratch: '/work/.scratch',
  alive,
});

function slowHost(alive: () => boolean) {
  let opened = 0;
  const closed: number[] = [];
  let gate: Deferred.Deferred<void> | null = null;
  const host = {
    kind: 'sandbox',
    world: Effect.fnUntraced(function* () {
      opened += 1;
      const mine = opened;
      if (gate !== null) yield* Deferred.await(gate);
      yield* Effect.addFinalizer(() => Effect.sync(() => closed.push(mine)));
      return guest(alive);
    }),
  };
  return {
    host,
    opened: () => opened,
    closed: () => closed,
    hold: () => Effect.map(Deferred.make<void>(), (made) => (gate = made)),
    release: () => (gate === null ? Effect.void : Deferred.succeed(gate, undefined)),
  };
}

const PLACE: ProvedRoot = {
  environment: {
    environmentId: 'host',
    kind: 'host',
    namespaceId: 'ns-1',
    identityWitness: { provider: 'test', format: 'v1', token: 'env' },
  },
  root: { namespaceId: 'ns-1', path: '/repo' },
  witness: { provider: 'test', format: 'v1', token: 'repo' },
  registration: null,
} as ProvedRoot;

const checkout = (_thread: { id: string }, root: string) =>
  Effect.succeed(checkoutWorld({ projectRoot: root, scratch: '/repo/.scratch', world: makeMachineWorld(() => null) }));
const place = () => Effect.succeed(PLACE);
const local = { id: 't1', hostKind: null, hostId: null };
const bound = { id: 't2', hostKind: 'sandbox', hostId: 's1' };

const at = (threadId: string, runId: string, generation: number): TargetAt => ({
  threadId,
  runId,
  generation: WorkspaceGeneration.make(generation),
});

const asking = (thread: typeof bound | typeof local, generation: number, root = '/repo') => ({
  thread,
  at: at(thread.id, 'run-1', generation),
  root,
});

it.live(
  'no host is the checkout at the tree the target names; a sandbox host is its guest, held while alive and reopened once it is not',
  () =>
    Effect.gen(function* () {
      let alive = true;
      const engine = slowHost(() => alive);
      const worlds = yield* makeLeasedWorlds({ checkout, hosts: [engine.host], place });
      try {
        const here = yield* worlds.of(asking(local, 0));
        expect(here.world.kind).toBe('checkout');
        expect(here.world.root).toBe('/repo');
        expect(here.world.world.environment.platform).toBe(process.platform);
        expect(here.place).toEqual(PLACE);

        const first = yield* worlds.of(asking(bound, 0));
        expect(first.world.kind).toBe('sandbox');
        expect(first.world.world.environment.platform).toBe('linux');
        expect(first.place).toBeNull();
        yield* worlds.of(asking(bound, 0));
        expect(engine.opened()).toBe(1);

        alive = false;
        yield* worlds.of(asking(bound, 0));
        expect(engine.opened()).toBe(2);
        expect(engine.closed()).toEqual([1]);
      } finally {
        yield* worlds.closeAll();
      }
      expect(engine.closed()).toEqual([1, 2]);
    }),
);

it.live('two asks that meet open one world, and both hold the same one', () =>
  Effect.gen(function* () {
    const engine = slowHost(() => true);
    const worlds = yield* makeLeasedWorlds({ checkout, hosts: [engine.host], place });
    try {
      yield* engine.hold();
      const [a, b] = yield* Effect.gen(function* () {
        const one = yield* Effect.forkChild(worlds.of(asking(bound, 0)));
        const two = yield* Effect.forkChild(worlds.of(asking(bound, 0)));
        yield* Effect.sleep('20 millis');
        yield* engine.release();
        return yield* Effect.all([Fiber.join(one), Fiber.join(two)]);
      });
      expect(a).toBe(b);
      expect(engine.opened()).toBe(1);
    } finally {
      yield* worlds.closeAll();
    }
    expect(engine.closed()).toEqual([1]);
  }),
);

it.live('an ask interrupted while its world opens leaves a world the holder still closes', () =>
  Effect.gen(function* () {
    const engine = slowHost(() => true);
    const worlds = yield* makeLeasedWorlds({ checkout, hosts: [engine.host], place });
    try {
      yield* engine.hold();
      const exit = yield* Effect.gen(function* () {
        const asked = yield* Effect.forkChild(worlds.of(asking(bound, 0)));
        yield* Effect.sleep('20 millis');
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(asked));
        yield* Effect.sleep('20 millis');
        yield* engine.release();
        yield* Fiber.join(interrupting);
        return yield* Fiber.await(asked);
      });
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      yield* worlds.of(asking(bound, 0));
      expect(engine.opened()).toBe(1);
    } finally {
      yield* worlds.closeAll();
    }
    expect(engine.closed()).toEqual([1]);
  }),
);

it.live('a drop closes every world the thread held, and a host kind nothing mounted refuses with the kind', () =>
  Effect.gen(function* () {
    const engine = slowHost(() => true);
    const worlds = yield* makeLeasedWorlds({ checkout, hosts: [engine.host], place });
    yield* worlds.of(asking(bound, 0));
    yield* worlds.of(asking(bound, 1));
    expect(engine.opened()).toBe(2);
    yield* worlds.drop(bound.id);
    expect(engine.closed()).toEqual([1, 2]);
    yield* worlds.drop(bound.id);
    expect(engine.closed()).toEqual([1, 2]);

    const refused = yield* Effect.flip(
      worlds.of({ thread: { id: 't3', hostKind: 'vm', hostId: 'v1' }, at: at('t3', 'run-1', 0), root: '/repo' }),
    );
    expect(refused._tag).toBe('WorldUnavailable');
    expect(refused.hostKind).toBe('vm');
    expect(refused.message).toContain('no host of kind vm');
  }),
);

it.live('a generation released late cannot discard the world of a newer generation at the same tree', () =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const worlds = yield* makeLeasedWorlds({
      checkout: (_thread, root) => {
        opened.push(root);
        return Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) }));
      },
      hosts: [],
      place,
    });
    try {
      const held = yield* worlds.of(asking(local, 0, '/repo'));
      const moved = yield* worlds.of(asking(local, 1, '/repo'));
      expect(opened).toEqual(['/repo', '/repo']);
      expect(moved).not.toBe(held);

      yield* worlds.release(at(local.id, 'run-1', 0));

      const again = yield* worlds.of(asking(local, 1, '/repo'));
      expect(again).toBe(moved);
      expect(opened).toEqual(['/repo', '/repo']);

      const reopened = yield* worlds.of(asking(local, 0, '/repo'));
      expect(reopened).not.toBe(held);
      expect(opened).toEqual(['/repo', '/repo', '/repo']);
    } finally {
      yield* worlds.closeAll();
    }
  }),
);

it.live('each generation opens its world at the tree its own target names', () =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const worlds = yield* makeLeasedWorlds({
      checkout: (_thread, root) => {
        opened.push(root);
        return Effect.succeed(checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) }));
      },
      hosts: [],
      place,
    });
    try {
      const held = yield* worlds.of(asking(local, 0, '/repo'));
      const moved = yield* worlds.of(asking(local, 1, '/worktree'));
      expect(held.world.root).toBe('/repo');
      expect(moved.world.root).toBe('/worktree');
      expect(opened).toEqual(['/repo', '/worktree']);
    } finally {
      yield* worlds.closeAll();
    }
  }),
);

it.live('a settled run lets go of every generation it worked in, and leaves another run of the thread standing', () =>
  Effect.gen(function* () {
    const worlds = yield* makeLeasedWorlds({ checkout, hosts: [], place });
    try {
      const other = { thread: local, at: at(local.id, 'run-2', 0), root: '/repo' };
      const first = yield* worlds.of(asking(local, 0));
      yield* worlds.of(asking(local, 1));
      const survivor = yield* worlds.of(other);

      yield* worlds.releaseRun(local.id, 'run-1');
      expect(yield* worlds.of(other)).toBe(survivor);
      expect(yield* worlds.of(asking(local, 0))).not.toBe(first);
    } finally {
      yield* worlds.closeAll();
    }
  }),
);

const leasedWorlds = Effect.fnUntraced(function* () {
  const closed: string[] = [];
  const scopes = new Map<string, Scope.Scope>();
  const worlds = yield* makeLeasedWorlds({
    checkout: Effect.fnUntraced(function* (thread, root, _runId, lease) {
      scopes.set(thread.id, yield* Effect.scope);
      leases.set(thread.id, lease);
      yield* Effect.addFinalizer(() => Effect.sync(() => closed.push(root)));
      return checkoutWorld({ projectRoot: root, scratch: `${root}/.scratch`, world: makeMachineWorld(() => null) });
    }),
    hosts: [],
    place,
  });
  const leases = new Map<string, () => Effect.Effect<WorldLease>>();
  return { worlds, closed: () => closed, scopeOf: (id: string) => scopes.get(id)! };
});

it.live('a run that settles while a command observes lets go of its own claim and leaves the world open', () =>
  Effect.gen(function* () {
    const stack = yield* leasedWorlds();
    const observing = Deferred.makeUnsafe<void>();
    const cut: string[] = [];
    try {
      yield* Effect.scoped(stack.worlds.of(asking(local, 0)));
      const lease = yield* Effect.scoped(stack.worlds.lease(at(local.id, 'run-1', 0)));
      yield* Effect.scoped(
        Effect.forkIn(Deferred.await(observing).pipe(Effect.onExit((exit) => Effect.sync(() => cut.push(exit._tag)))), lease.scope),
      );

      yield* Effect.scoped(stack.worlds.releaseRun(local.id, 'run-1'));
      yield* Effect.scoped(Effect.sleep('20 millis'));
      expect(stack.closed()).toEqual([]);
      expect(cut).toEqual([]);

      const reopened = yield* Effect.scoped(stack.worlds.of(asking(local, 0)));
      expect(reopened.world.root).toBe('/repo');
      expect(stack.closed()).toEqual([]);

      yield* Effect.scoped(Deferred.succeed(observing, undefined));
      yield* Effect.scoped(lease.release);
      expect(stack.closed()).toEqual(['/repo']);
      yield* Effect.scoped(lease.release);
      expect(stack.closed()).toEqual(['/repo']);
    } finally {
      yield* Effect.scoped(stack.worlds.closeAll());
    }
  }),
);

it.live('a lease over an admitted context that no longer stands is a claim on a closed lifetime, not a hold on a live one', () =>
  Effect.gen(function* () {
    const stack = yield* leasedWorlds();
    yield* Effect.scoped(stack.worlds.of(asking(local, 0)));
    yield* Effect.scoped(stack.worlds.releaseRun(local.id, 'run-1'));
    expect(stack.closed()).toEqual(['/repo']);

    const lease = yield* Effect.scoped(stack.worlds.lease(at(local.id, 'run-1', 0)));
    const exit = yield* Effect.scoped(Effect.flatMap(Effect.forkIn(Effect.never, lease.scope), (fiber) => Fiber.await(fiber)));
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    yield* Effect.scoped(lease.release);
  }),
);

it.live('the stack closing takes the worlds its settled runs left standing for their commands', () =>
  Effect.gen(function* () {
    const stack = yield* leasedWorlds();
    yield* Effect.scoped(stack.worlds.of(asking(local, 0)));
    const lease = yield* Effect.scoped(stack.worlds.lease(at(local.id, 'run-1', 0)));
    yield* Effect.scoped(stack.worlds.releaseRun(local.id, 'run-1'));
    expect(stack.closed()).toEqual([]);
    yield* Effect.scoped(stack.worlds.closeAll());
    expect(stack.closed()).toEqual(['/repo']);
    yield* Effect.scoped(lease.release);
  }),
);

it.live('one world that will not close does not keep the rest of the release', () =>
  Effect.gen(function* () {
    const closed: string[] = [];
    let opened = 0;
    const worlds = yield* makeLeasedWorlds({
      checkout,
      hosts: [
        {
          kind: 'sandbox',
          world: Effect.fnUntraced(function* () {
            opened += 1;
            const mine = opened;
            yield* Effect.addFinalizer(() =>
              mine === 1 ? Effect.die(new Error(`world ${mine} will not close`)) : Effect.sync(() => closed.push(`world-${mine}`)),
            );
            return guest(() => true);
          }),
        },
      ],
      place,
    });
    yield* worlds.of(asking(bound, 0));
    yield* worlds.of(asking(bound, 1));
    expect(opened).toBe(2);
    yield* worlds.drop(bound.id);
    expect(closed).toEqual(['world-2']);
  }),
);
