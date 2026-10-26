import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, Fiber, FileSystem, Layer, Schedule, Stream } from 'effect';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostLauncher } from '@runlith/executions/HostLauncher';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { RecordFiles } from '@runlith/executions/RecordFiles';
import { recordFolder } from '@runlith/executions/recordFormat';
import { recoveryClient } from '@runlith/executions/RecoveryClient';
import { HostRequestKey, type HostRequestRef } from '@runlith/executions/protocol/execution';
import type { EndingReceipt, StopReceipt } from '@runlith/executions/protocol/stop';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { hostPolicy, hostShare, hostWireLimits, principalOf } from './hostFixture';
import { makeProcessWorld, type ProcessWorld } from './composition/testing/servedWorld';
import { processLayer } from './composition/macos';
import { processControl } from './posix/control';
import { HOLDER_LIBRARY } from './posix/testing/holder';
import { Processes } from './ProcessReader';
import { ProcessControl } from './ProcessControl';
import { perform } from './recovery';

const policy = hostPolicy({ executions: 4, transports: ['pipes'], custodyReceipts: 16 });
const limits = hostWireLimits(policy, 4, { envelopeBytes: 16384, connections: 4, requests: 8 });
const share = hostShare(policy, 4);
const processes = Layer.effect(ProcessControl, Effect.map(Processes, processControl)).pipe(
  Layer.provideMerge(processLayer(HOLDER_LIBRARY)),
);
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection, RecordFiles.layer, processes).pipe(
  Layer.provideMerge(BunServices.layer),
);
const world = (directory?: string) => makeProcessWorld({ prefix: 'host-death-', policy, limits, share, directory });
const key = (host: ProcessWorld, name: string): HostRequestRef => ({
  installation: host.registration.installation,
  operation: HostRequestKey.make(name),
});
const launch = (cwd: string, program: string, args: readonly string[]): LaunchRequest => ({
  command: { program, args, cwd, environment: [] },
  transport: { _tag: 'pipes', stdin: 'ignore' },
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'e', namespace: 'n', cwd, dependencies: [] },
  holder: principalOf('tester'),
  origin: principalOf('tester'),
});
type StartInput = { readonly host: ProcessWorld; readonly name: string; readonly request: LaunchRequest };
const start = Effect.fnUntraced(function* ({ host, name, request }: StartInput) {
  const reader = yield* Processes;
  const control = yield* ProcessControl;
  const started = yield* host.client.start(key(host, name), request);
  if (started._tag !== 'Started') return yield* Effect.die(new Error(`the child did not start: ${started._tag}`));
  if (started.native.pid !== undefined) {
    const witness = reader.identity(started.native.pid);
    if (witness._tag === 'Unreadable') return yield* Effect.die(new Error(witness.detail));
    if (witness._tag === 'Read')
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const sent = yield* control.signal(witness, 'SIGKILL');
          if (sent !== 'delivered' && sent !== 'gone' && sent !== 'changed') return yield* Effect.die(new Error(`child cleanup: ${sent}`));
          yield* control
            .standing(witness)
            .pipe(Effect.repeat({ until: (state) => state === 'gone' || state === 'changed', schedule: Schedule.spaced('10 millis') }));
        }),
      );
  }
  return started.execution;
});
const populationsOf = (receipt: EndingReceipt | StopReceipt) => ({
  nativeExit: receipt.nativeExit,
  coverage: receipt.coverage,
  relation: receipt.relation,
  confirmed: receipt.confirmed,
  residual: receipt.residual,
  unverifiable: receipt.unverifiable,
  streams: receipt.streams,
  cleanup: receipt.cleanup,
  retention: receipt.retention,
  abandonedOutput: receipt.abandonedOutput,
});
const trapped = Effect.fnUntraced(function* (host: ProcessWorld, name: string) {
  const ref = yield* start({
    host,
    name,
    request: launch(host.directory, '/bin/sh', ['-c', 'trap "" INT TERM; echo READY; exec sleep 30']),
  });
  let text = '';
  yield* Stream.runDrain(
    Stream.takeUntil(
      host.client.subscribe({ _tag: 'Bytes', cursor: { ref, stream: 'stdout', offset: byteOffset(0n) } }, limits.credits),
      (delivery) => {
        if (delivery._tag === 'Bytes') text += new TextDecoder().decode(delivery.bytes);
        return text.includes('READY');
      },
    ),
  );
  return ref;
});
const inFlight = (host: ProcessWorld, name: string) =>
  host.client.operation(key(host, name)).pipe(
    Effect.repeat({
      until: (answer) => answer._tag === 'Uncertain' && answer.effect._tag === 'InFlight',
      schedule: Schedule.spaced('10 millis'),
    }),
  );

layer(platform, { excludeTestServices: true, testTimeout: '30 seconds' })('a host killed outright', (it) => {
  it.effect(
    'leaves inspectable state but no live road, then replaces the incarnation without replaying its work',
    Effect.fnUntraced(function* () {
      const host = yield* world();
      const files = yield* FileSystem.FileSystem;
      expect((yield* host.client.take(key(host, 'take'), 0))._tag).toBe('Held');
      const echo = yield* start({ host, name: 'echo', request: launch(host.directory, '/bin/echo', ['corpse-bytes']) });
      const measured = yield* host.client
        .ending(echo)
        .pipe(Effect.repeat({ until: (ending) => ending !== undefined, schedule: Schedule.spaced('25 millis') }));
      expect(measured?.nativeExit).toEqual({ _tag: 'Code', code: 0 });
      expect(measured?.cleanup).toBe('complete');
      expect((yield* host.client.stop(key(host, 'echo-stop'), echo, 'explicit-stop', 'signal')).cleanup).toBe('complete');
      expect((yield* host.client.retire(key(host, 'echo-retire'), echo))._tag).toBe('Retired');
      const running = yield* start({ host, name: 'sleep', request: launch(host.directory, '/bin/sleep', ['30']) });
      const before = yield* host.client.status();
      yield* host.crash;
      for (const path of [host.registration.endpoint.path, `${host.directory}/registration.json`, `${host.directory}/executions.sqlite`])
        expect(yield* files.exists(path)).toBe(true);
      const registration = yield* (yield* HostRegistration).read(host.directory);
      expect(registration.installation).toBe(host.registration.installation);
      const address = { state: host.directory, installation: registration.installation };
      const launcher = yield* HostLauncher.make(address, 'custodian', limits);
      expect((yield* launcher.standing())._tag).toBe('Unavailable');
      const recovery = yield* recoveryClient(address, limits);
      for (const act of [
        recovery.status().pipe(Effect.asVoid),
        recovery.list({ limit: 4 }).pipe(Effect.asVoid),
        recovery.operation(key(host, 'echo')).pipe(Effect.asVoid),
      ]) {
        expect(yield* Effect.flip(act)).toMatchObject({ _tag: 'WireUnavailable', kind: 'unreachable', sent: false });
      }
      for (const verb of ['status', 'list'] as const) {
        const refused = yield* Effect.flip(perform({ state: host.directory, verb, arguments: [] }));
        expect(refused._tag).toBe('RecoveryRefused');
        expect(refused.detail).toContain('unreachable');
      }
      const records = yield* RecordFiles;
      expect(yield* Effect.flip(records.open(`${host.directory}/records`, running))).toMatchObject({ _tag: 'RecordSealMissing' });
      yield* Effect.flip(records.open(`${host.directory}/records`, echo));
      expect(yield* files.exists(`${host.directory}/records/${recordFolder(echo.execution)}`)).toBe(false);
      const replacement = yield* world(host.directory);
      const after = yield* replacement.client.status();
      expect(after.incarnation).toBe(before.incarnation + 1);
      expect((yield* replacement.client.list({ limit: 4 })).executions).toEqual([]);
      for (const ref of [echo, running]) {
        expect(yield* Effect.flip(replacement.client.state(ref))).toMatchObject({
          _tag: 'HostRefused',
          refusal: { _tag: 'HostUnavailable' },
        });
      }
      for (const name of ['echo', 'sleep']) {
        expect(yield* replacement.client.callResult(key(host, name))).toMatchObject({ _tag: 'Settled', result: { _tag: 'Unavailable' } });
        expect(yield* replacement.client.operation(key(host, name))).toMatchObject({
          _tag: 'Refused',
          refusal: { _tag: 'IncarnationMismatch' },
        });
      }
      expect((yield* replacement.client.take(key(replacement, 'next-take'), after.custody.revision))._tag).toBe('Held');
      expect((yield* replacement.client.start(key(host, 'echo'), launch(host.directory, '/bin/echo', ['corpse-bytes'])))._tag).toBe(
        'Refused',
      );
      expect(yield* Effect.flip(replacement.client.read({ ref: echo, stream: 'stdout', offset: byteOffset(0n) }, 64))).toMatchObject({
        _tag: 'HostRefused',
        refusal: { _tag: 'HostConflict', reason: 'RecordReadFailed' },
      });
      expect(yield* files.exists(`${host.directory}/records`)).toBe(true);
    }),
  );
  it.effect(
    'reads back stop intent and forgotten populations, and never reuses a stop interrupted by replacement',
    Effect.fnUntraced(function* () {
      const host = yield* world();
      expect((yield* host.client.take(key(host, 'take'), 0))._tag).toBe('Held');
      const plain = yield* start({ host, name: 'plain', request: launch(host.directory, '/bin/sleep', ['30']) });
      const receipt = yield* host.client.stop(key(host, 'plain-stop'), plain, 'explicit-stop', 'signal');
      expect(yield* host.client.operation(key(host, 'plain-stop'))).toMatchObject({ _tag: 'Accepted', execution: plain });
      expect((yield* host.client.retire(key(host, 'plain-retire'), plain))._tag).toBe('Retired');
      const ending = yield* host.client.ending(plain);
      if (ending === undefined) return yield* Effect.die(new Error('the forgotten stop lost its ending'));
      expect(populationsOf(ending)).toEqual({ ...populationsOf(receipt), retention: 'lost' });
      expect((yield* host.client.operation(key(host, 'never')))._tag).toBe('Unanswered');
      const completed = yield* trapped(host, 'trapped');
      const stopping = yield* Effect.forkScoped(host.client.stop(key(host, 'trapped-stop'), completed, 'explicit-stop', 'signal'));
      expect((yield* inFlight(host, 'trapped-stop'))._tag).toBe('Uncertain');
      yield* Fiber.join(stopping);
      expect(yield* host.client.operation(key(host, 'trapped-stop'))).toMatchObject({ _tag: 'Accepted', execution: completed });
      const interrupted = yield* trapped(host, 'interrupted');
      const lost = yield* Effect.forkScoped(host.client.stop(key(host, 'interrupted-stop'), interrupted, 'explicit-stop', 'signal'));
      yield* inFlight(host, 'interrupted-stop');
      yield* host.crash;
      yield* Fiber.interrupt(lost);
      const replacement = yield* world(host.directory);
      for (const name of ['plain-stop', 'interrupted-stop'])
        expect(yield* replacement.client.operation(key(host, name))).toMatchObject({
          _tag: 'Refused',
          refusal: { _tag: 'IncarnationMismatch' },
        });
      expect(yield* replacement.client.ending(plain)).toMatchObject({ measurement: 'recorded', cleanup: receipt.cleanup });
    }),
  );
});
