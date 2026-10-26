import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Layer, Schedule, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 1, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 8 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

layer(platform, { excludeTestServices: true })('a reader slot goes back when its subscription ends', (it) => {
  it.effect(
    'a quiet execution admits a third subscription after two earlier subscriptions close',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'reader-release-',
        policy,
        share: hostShare(policy, 1),
        limits,
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('reader-release-take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const launch: LaunchRequest = {
        command: { program: '/bin/sh', args: ['-c', 'echo hello; exec sleep 30'], environment: [] },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'call',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
      };
      const started = yield* client.start(key('reader-release-start'), launch);
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`the start did not start: ${started._tag}`));
      const execution = started.execution;
      const cursor = { ref: execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const line = BigInt(new TextEncoder().encode('hello\n').length);
      const watchedOnce = Effect.scoped(
        Effect.gen(function* () {
          const drained = yield* Deferred.make<void>();
          const reading = yield* Stream.runDrain(
            Stream.tap(client.subscribe({ _tag: 'Bytes', cursor }, 65536), (delivery) =>
              delivery._tag === 'Bytes' && offsetValue(delivery.range.next) >= line ? Deferred.succeed(drained, undefined) : Effect.void,
            ),
          ).pipe(Effect.forkScoped);
          yield* Effect.raceFirst(
            Deferred.await(drained),
            Fiber.join(reading).pipe(Effect.andThen(Effect.die(new Error('the subscription ended before its first line')))),
          );
        }),
      );
      yield* watchedOnce;
      yield* watchedOnce;
      const third = yield* Stream.runCollect(
        Stream.takeUntil(
          client.subscribe({ _tag: 'Bytes', cursor }, 65536),
          (delivery) => delivery._tag === 'Bytes' && offsetValue(delivery.range.next) >= line,
        ),
      ).pipe(
        Effect.retry({
          while: (failure) => failure._tag === 'HostRefused' && failure.refusal._tag === 'CapacityExceeded',
          schedule: Schedule.spaced('20 millis'),
        }),
      );
      expect(third.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join('')).toBe('hello\n');
      yield* client.stop(key('reader-release-stop'), execution, 'explicit-stop', 'signal');
    }),
  );
});
