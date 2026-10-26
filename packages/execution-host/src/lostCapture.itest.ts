import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer, Schedule, Scope, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';
import { ChannelFailed, Holder, type Readable } from './holder/Holder';
import { testHolder } from './posix/testing/holder';
import { ProcessControl } from './ProcessControl';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 2, requests: 8 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

const failing = (stdout: Readable): Readable => {
  let delivered = false;
  return {
    read: (limit) =>
      Effect.suspend(() =>
        delivered
          ? Effect.fail(new ChannelFailed({ reason: 'os', detail: 'read: EIO' }))
          : Effect.tap(stdout.read(limit), (chunk) =>
              Effect.sync(() => {
                delivered = chunk !== undefined && chunk.length > 0;
              }),
            ),
      ),
    stopReading: stdout.stopReading,
  };
};

const losingHolder = (state: string) =>
  Layer.effect(
    Holder,
    Effect.gen(function* () {
      const real = yield* Holder;
      const control = yield* ProcessControl;
      const scope = yield* Effect.scope;
      return Holder.of({
        ...real,
        get held() {
          return real.held;
        },
        launch: Effect.fnUntraced(function* (launch) {
          const held = yield* real.launch(launch);
          if (!launch.argv.some((argument) => argument.includes('LOSTCAPTURE')) || held.channels._tag !== 'pipes') return held;
          const witness = { pid: held.pid, birth: held.birth };
          yield* Scope.addFinalizer(
            scope,
            Effect.gen(function* () {
              yield* control.act(witness, 'kill');
              yield* control
                .standing(witness)
                .pipe(Effect.repeat({ while: (standing) => standing === 'standing', schedule: Schedule.spaced('1 millis') }));
            }),
          );
          return { ...held, channels: { ...held.channels, stdout: failing(held.channels.stdout) } };
        }),
      });
    }),
  ).pipe(Layer.provideMerge(testHolder(state)));

layer(platform, { excludeTestServices: true })('a command whose stdout capture broke', (it) => {
  it.effect(
    'ends its byte subscription unavailable, not completed, while the process still runs',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'lost-capture-',
        policy,
        share: hostShare(policy, 2),
        limits,
        holder: losingHolder,
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('lost-take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const launch: LaunchRequest = {
        command: { program: '/bin/sh', args: ['-c', "printf 'kept\\n'; exec sleep 30 # LOSTCAPTURE"], environment: [] },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'held',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
      };
      const started = yield* client.start(key('lost-start'), launch);
      if (started._tag !== 'Started' && started._tag !== 'Accepted')
        return yield* Effect.die(new Error(`the start did not start: ${started._tag}`));
      const cursor = { ref: started.execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const bytes = yield* Stream.runCollect(
        Stream.takeUntil(client.subscribe({ _tag: 'Bytes', cursor }, 65536), (delivery) => delivery._tag === 'Ended'),
      );
      const standing = yield* Stream.runHead(client.subscribe({ _tag: 'State', execution: started.execution }, limits.credits));
      expect(bytes.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join('')).toBe('kept\n');
      expect(bytes.at(-1)).toEqual({ _tag: 'Ended', ending: 'unavailable' });
      expect(standing._tag === 'Some' && standing.value._tag === 'State' ? standing.value.summary.state.phase : undefined).toBe('running');
    }),
  );

  it.effect(
    'ends a byte subscription opened after its record was sealed unavailable, not completed',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'lost-sealed-',
        policy,
        share: hostShare(policy, 2),
        limits,
        holder: losingHolder,
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('sealed-take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const launch: LaunchRequest = {
        command: { program: '/bin/sh', args: ['-c', "printf 'kept\\n' # LOSTCAPTURE"], environment: [] },
        transport: { _tag: 'pipes', stdin: 'ignore' },
        lifetime: 'command',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
        admission: {
          origin: { scope: 'project-1', owner: 'tester', cohort: 'wave-1' },
          limits: { executionMs: 600_000, executionCeilingMs: 900_000 },
          policyIdentity: 'policy-1',
        },
      };
      const started = yield* client.start(key('sealed-start'), launch);
      if (started._tag !== 'Started' && started._tag !== 'Accepted')
        return yield* Effect.die(new Error(`the start did not start: ${started._tag}`));
      yield* Stream.runDrain(
        Stream.takeUntil(
          client.subscribe({ _tag: 'State', execution: started.execution }, limits.credits),
          (delivery) => delivery._tag === 'Ended',
        ),
      );
      const cursor = { ref: started.execution, stream: 'stdout' as const, offset: byteOffset(0n) };
      const bytes = yield* Stream.runCollect(
        Stream.takeUntil(client.subscribe({ _tag: 'Bytes', cursor }, 65536), (delivery) => delivery._tag === 'Ended'),
      );
      expect(bytes.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join('')).toBe('kept\n');
      expect(bytes.at(-1)).toEqual({ _tag: 'Ended', ending: 'unavailable' });
    }),
  );
});
