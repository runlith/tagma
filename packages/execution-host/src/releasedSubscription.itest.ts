import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Layer, Stream } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import type { ExecutionFeedItem } from '@runlith/executions/Executions';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 2, transports: ['pipes'], custodyReceipts: 8 });
const limits = hostWireLimits(policy, 2, { envelopeBytes: 16384, connections: 2, requests: 8 });
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));
const untilEnded = <E, R>(deliveries: Stream.Stream<ExecutionFeedItem, E, R>) =>
  Stream.runCollect(Stream.takeUntil(deliveries, (delivery) => delivery._tag === 'Ended'));

layer(platform, { excludeTestServices: true })('a released command over the wire', (it) => {
  it.effect(
    'delivers its sealed record and completes subscriptions until its owner disowns it',
    Effect.fnUntraced(function* () {
      const { client, directory, registration } = yield* makeWorld({
        prefix: 'released-subscription-',
        policy,
        share: hostShare(policy, 2),
        limits,
      });
      const key = (name: string): HostRequestRef => ({ installation: registration.installation, operation: HostRequestKey.make(name) });
      expect((yield* client.take(key('released-take'), 0))._tag).toBe('Held');
      const principal = principalOf('tester');
      const launch: LaunchRequest = {
        command: { program: '/bin/sh', args: ['-c', "printf 'kept\\n'; printf 'failure\\n' >&2; exit 1"], environment: [] },
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
      const started = yield* client.start(key('released-start'), launch);
      if (started._tag !== 'Started' && started._tag !== 'Accepted')
        return yield* Effect.die(new Error(`the start did not start: ${started._tag}`));
      const ref = started.execution;
      const states = yield* untilEnded(client.subscribe({ _tag: 'State', execution: ref }, limits.credits));
      const status = yield* client.status();
      const cursor = { ref, stream: 'stdout' as const, offset: byteOffset(0n) };
      const bytes = yield* untilEnded(client.subscribe({ _tag: 'Bytes', cursor }, 65536));
      const stderr = yield* untilEnded(client.subscribe({ _tag: 'Bytes', cursor: { ...cursor, stream: 'stderr' } }, 65536));
      const output = yield* untilEnded(client.subscribe({ _tag: 'Bytes', cursor: { ...cursor, stream: 'output' } }, 65536));
      const uncarried = { ...cursor, stream: 'pty' as const };
      const unreadable = yield* Effect.flip(client.read(uncarried, 64));
      const unsubscribed = yield* Effect.flip(Stream.runCollect(client.subscribe({ _tag: 'Bytes', cursor: uncarried }, 65536)));
      const reread = yield* untilEnded(client.subscribe({ _tag: 'State', execution: ref }, limits.credits));
      const report = yield* client.disown({ owner: 'tester' });
      const after = yield* Effect.flip(client.read(cursor, 64));
      const firstDecision = states.find((delivery) => delivery._tag === 'State' && delivery.summary.decision !== undefined);
      expect(firstDecision?._tag === 'State' ? firstDecision.summary : undefined).toMatchObject({
        decision: { _tag: 'Completed' },
        cost: { _tag: 'Measured' },
      });
      const lastState = states.filter((delivery) => delivery._tag === 'State').at(-1);
      expect(lastState?._tag === 'State' ? lastState.summary : undefined).toMatchObject({
        state: { phase: 'ended', nativeExit: { _tag: 'Code', code: 1 }, cleanup: 'complete' },
        decision: { _tag: 'Completed' },
        cost: { _tag: 'Measured' },
      });
      expect(states.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(status.kept?.records).toBe(1);
      expect(bytes.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join('')).toBe('kept\n');
      expect(bytes.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(stderr.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join('')).toBe(
        'failure\n',
      );
      expect(stderr.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(['kept\nfailure\n', 'failure\nkept\n']).toContain(
        output.map((delivery) => (delivery._tag === 'Bytes' ? new TextDecoder().decode(delivery.bytes) : '')).join(''),
      );
      expect(output.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(unreadable).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'StreamMissing' } });
      expect(unsubscribed).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'StreamMissing' } });
      const copied = reread.find((delivery) => delivery._tag === 'State');
      expect(copied?._tag === 'State' ? copied.summary.state : undefined).toMatchObject({
        phase: 'ended',
        nativeExit: { _tag: 'Code', code: 1 },
        cleanup: 'complete',
      });
      expect(reread.at(-1)).toEqual({ _tag: 'Ended', ending: 'completed' });
      expect(report).toEqual({ retired: 1 });
      expect(after).toMatchObject({ _tag: 'HostRefused', refusal: { _tag: 'HostConflict', reason: 'RecordReadFailed' } });
    }),
  );
});
