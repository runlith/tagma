import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, Layer, Schedule, Stream } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 1, transports: ['pty'] });
const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));

layer(platform, { excludeTestServices: true })('a share lowered on an idle host', (it) => {
  it.effect(
    'gives history back without ending the terminal',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'grant-reclaim-',
        policy,
        limits,
        share: hostShare(policy, 1),
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('take'), 0))._tag).toBe('Held');
      const principal = principalOf('grant-tester');
      const request: LaunchRequest = {
        command: {
          program: '/bin/sh',
          args: ['-c', 'seq 1 400; printf HISTORY_READY; exec sleep 30'],
          environment: [
            { name: 'PATH', value: '/usr/bin:/bin' },
            { name: 'TERM', value: 'xterm-256color' },
          ],
          cwd: directory,
        },
        transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
        lifetime: 'held',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: principal,
        origin: principal,
        budget: {},
      };
      const started = yield* client.start(key('terminal'), request);
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`the terminal was not started: ${started._tag}`));
      const execution = started.execution;
      let output = '';
      yield* Stream.runDrain(
        Stream.takeUntil(
          client.subscribe(
            {
              _tag: 'Bytes',
              cursor: { ref: execution, stream: 'pty', offset: byteOffset(0n) },
            },
            limits.frameBytes,
          ),
          (delivery) => {
            if (delivery._tag === 'Bytes') output += new TextDecoder().decode(delivery.bytes);
            return output.includes('HISTORY_READY');
          },
        ),
      );
      const before = yield* client.status().pipe(
        Effect.repeat({
          schedule: Schedule.spaced('20 millis'),
          until: (status) => status.memory.retained > 0,
        }),
        Effect.map((status) => status.memory),
      );
      const lowered = yield* client.grant(key('lower'), (before.reserved + Math.floor(before.retained / 2)) / before.granted.machineBytes);
      expect(lowered._tag).toBe('Granted');
      if (lowered._tag !== 'Granted') return yield* Effect.die(new Error(`the grant was not lowered: ${lowered._tag}`));
      expect(lowered.over).toBeGreaterThan(0);
      const after = yield* client.status().pipe(
        Effect.repeat({
          schedule: Schedule.spaced('20 millis'),
          until: ({ memory }) => memory.reserved + memory.retained <= memory.granted.grantBytes,
        }),
        Effect.map((status) => status.memory),
      );
      expect(after.retained).toBeLessThan(before.retained);
      expect(after.reserved).toBe(before.reserved);
      const listed = yield* client.list({ limit: 1 });
      expect(listed.executions.find((row) => row.state.ref.execution === execution.execution)?.state.phase).toBe('running');
      expect((yield* client.screen(execution))._tag).toBe('ScreenTextFrame');
      yield* client.stop(key('stop'), execution, 'explicit-stop', 'signal');
    }),
  );
});
