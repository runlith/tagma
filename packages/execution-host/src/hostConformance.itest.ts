import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem, Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Conformance, describeHostConformance } from '@runlith/executions/conformance/hostConformance';
import { hostPolicy, hostProfile, hostShare, hostWireLimits, registrationOf } from './hostFixture';
import { heldHost, HOLDER_LIBRARY } from './posix/testing/holder';
import { makeWorld } from './composition/testing/servedWorld';

const policy = hostPolicy({ executions: 6, transports: ['pipes'] });
const limits = hostWireLimits(policy, 6, { envelopeBytes: 16384, connections: 2, requests: 4 });
const share = hostShare(policy, 6);
const platform = Layer.mergeAll(HostRegistration.layer, endpointConnection).pipe(Layer.provideMerge(BunServices.layer));
const fixture = Layer.effect(
  Conformance,
  Effect.gen(function* () {
    const world = yield* makeWorld({ prefix: 'host-conformance-', policy, share, limits });
    return Conformance.of({
      port: world.client,
      profile: hostProfile({ executions: 6, transports: ['pipes'] }),
      installation: world.registration.installation,
      directory: world.directory,
      credits: limits.credits,
    });
  }),
).pipe(Layer.provide(platform));

describeHostConformance('stock host', fixture);

layer(platform, { excludeTestServices: true })('host boot admission', (it) => {
  it.effect(
    'refuses an unfunded policy before publishing registration or opening the store',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'host-invalid-policy-' });
      const registration = registrationOf(state);
      const boot = `${state}/boot.json`;
      yield* files.writeFileString(
        boot,
        JSON.stringify({
          state,
          registration,
          library: HOLDER_LIBRARY,
          policy: {
            ...policy,
            execution: { ...policy.execution, input: { ...policy.execution.input, chunkBytes: policy.execution.input.pendingBytes + 1 } },
          },
          share,
          limits,
          lifetime: 'with-parent',
        }),
        { mode: 0o600 },
      );
      const [program, ...args] = heldHost(`${import.meta.dir}/main.ts`, boot);
      if (program === undefined) return yield* Effect.die(new Error('the holder command is empty'));
      const child = yield* spawner.spawn(ChildProcess.make(program, args, { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }));
      yield* Effect.forkScoped(Stream.runDrain(child.stdout));
      yield* Effect.forkScoped(Stream.runDrain(child.stderr));
      expect(yield* child.exitCode).not.toBe(0);
      expect(yield* files.exists(`${state}/registration.json`)).toBe(false);
      expect(yield* files.exists(`${state}/executions.sqlite`)).toBe(false);
    }),
  );
});
