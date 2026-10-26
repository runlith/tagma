import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Deferred, Effect, Fiber, Layer, Schedule, Schema, Stream } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { ExecutionId, HostRequestRef } from '@runlith/executions/protocol/execution';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { InventoryFeedItem } from '@runlith/executions/protocol/inventory';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { HostFrame, SubscriptionId, WIRE_VERSION, frameSize } from '@runlith/executions/protocol/wire';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const COMMANDS = 4;
const policy = hostPolicy({ executions: COMMANDS, transports: ['pipes'] });
const limits = hostWireLimits(policy, COMMANDS, { envelopeBytes: 16384, connections: 2, requests: 4 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));
const encodeFrame = Schema.encodeEffect(Schema.fromJsonString(HostFrame));
type Watcher = {
  readonly opened: Deferred.Deferred<void>;
  readonly resume: Deferred.Deferred<void>;
  readonly abreast: Deferred.Deferred<void>;
  readonly state: { holding: readonly ExecutionId[]; updates: InventoryFeedItem[]; target: number };
};
const makeWatcher = Effect.gen(function* () {
  return {
    opened: yield* Deferred.make<void>(),
    resume: yield* Deferred.make<void>(),
    abreast: yield* Deferred.make<void>(),
    state: { holding: [], updates: [], target: Number.MAX_SAFE_INTEGER },
  } satisfies Watcher;
});

layer(platform, { excludeTestServices: true })('two subscribers across an inventory gap', (it) => {
  it.effect(
    'recover current identities without replaying missed transitions',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'inventory-gap-',
        policy,
        limits: { ...limits, connections: 1, subscriptions: 2 },
        share: hostShare(policy, COMMANDS),
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const page = client.commands({ limit: COMMANDS });
      const current = Effect.fnUntraced(function* () {
        const answer = yield* page;
        if (answer._tag !== 'Page') return yield* Effect.die(new Error(`the command page was refused: ${answer._tag}`));
        return answer.page;
      });
      const deliveryBytes = frameSize(
        new TextEncoder().encode(
          yield* encodeFrame({
            v: WIRE_VERSION,
            body: 'bytes',
            message: {
              _tag: 'Event',
              body: { _tag: 'Inventory', subscription: SubscriptionId.make(1), update: { _tag: 'Moved', revision: 99, usage: [] } },
            },
          }),
        ).length,
        0,
      );
      const watching = (watcher: Watcher) =>
        client.subscribe({ _tag: 'Inventory' }, 3 * deliveryBytes).pipe(
          Stream.takeUntil(
            (delivery) =>
              delivery._tag === 'Inventory' && delivery.update._tag === 'Moved' && delivery.update.revision >= watcher.state.target,
          ),
          Stream.runForEach((delivery) =>
            Effect.gen(function* () {
              if (delivery._tag !== 'Inventory') return;
              watcher.state.updates.push(delivery.update);
              if (delivery.update._tag === 'Gap' || !(yield* Deferred.isDone(watcher.opened))) {
                watcher.state.holding = (yield* current()).commands.map((entry) => entry.state.ref.execution);
                if (delivery.update._tag !== 'Gap') {
                  yield* Deferred.succeed(watcher.opened, undefined);
                  yield* Deferred.await(watcher.resume);
                }
              }
              if (delivery.update._tag === 'Moved' && delivery.update.revision >= watcher.state.target)
                yield* Deferred.succeed(watcher.abreast, undefined);
            }),
          ),
        );
      const watchers: readonly Watcher[] = [yield* makeWatcher, yield* makeWatcher];
      const fibers = yield* Effect.forEach(watchers, (watcher) => Effect.forkScoped(watching(watcher)));
      yield* Effect.forEach(watchers, (watcher) => Deferred.await(watcher.opened));
      for (const watcher of watchers) expect(watcher.state.holding).toEqual([]);
      const before = (yield* current()).revision;
      const principal = principalOf('gap-tester');
      const request: LaunchRequest = {
        command: { program: '/bin/sh', args: ['-c', 'exit 0'], environment: [], cwd: directory },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'command',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
        admission: {
          origin: { scope: 'project-1', owner: 'agent-1', cohort: 'wave-1' },
          limits: { executionMs: 60000, executionCeilingMs: 300000 },
          policyIdentity: 'policy-1',
        },
      };
      const refs = yield* Effect.forEach(
        Array.from({ length: COMMANDS }, (_, index) => index),
        Effect.fnUntraced(function* (index) {
          const answer = yield* client.start(key(`command-${index}`), request);
          if (answer._tag !== 'Accepted' && answer._tag !== 'Started')
            return yield* Effect.die(new Error(`the command was refused: ${answer._tag}`));
          return answer.execution;
        }),
      );
      const ended = yield* current().pipe(
        Effect.repeat({
          schedule: Schedule.spaced('5 millis'),
          until: (page) =>
            refs.every((ref) =>
              page.commands.some((entry) => entry.state.ref.execution === ref.execution && entry.state.phase === 'ended'),
            ),
        }),
      );
      for (const watcher of watchers) {
        watcher.state.target = ended.revision;
        yield* Deferred.succeed(watcher.resume, undefined);
      }
      yield* Effect.forEach(watchers, (watcher) => Deferred.await(watcher.abreast));
      yield* Effect.forEach(fibers, Fiber.interrupt);
      for (const watcher of watchers) {
        expect(watcher.state.updates[0]).toMatchObject({ _tag: 'Moved', revision: before });
        let revision = before;
        let moved = 0;
        let gaps = 0;
        for (const update of watcher.state.updates.slice(1)) {
          expect(update.revision).toBeGreaterThanOrEqual(revision);
          if (update._tag === 'Gap') {
            expect(update.revision - revision).toBeGreaterThan(1);
            gaps += 1;
          } else moved += 1;
          revision = update.revision;
        }
        expect(moved).toBeLessThan(revision - before);
        expect(gaps).toBeGreaterThan(0);
        expect(revision).toBeGreaterThanOrEqual(ended.revision);
        expect([...watcher.state.holding].sort()).toEqual(refs.map((ref) => ref.execution).sort());
      }
    }),
  );
});
