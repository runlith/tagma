import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect, Fiber, FileSystem, Layer, Schedule } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { type WireLimits } from '@runlith/executions/protocol/wire';
import { join, resolve } from 'node:path';
import { host, serve } from './host';
import { ChildProcessSpawner } from 'effect/process';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { platformLayer } from './composition/macos';
import { platformFacts } from './posix/macos/facts';
import { PS } from './posix/macos/evidence';
import { loadLibrary } from './posix/Library';
import { testHolder } from './posix/testing/holder';
import { credentialsLayer } from './posix/credentials';
import { fixtureHolder, fixtureFacts, hostPolicy, hostShare, hostTestRoot, hostWireLimits, registrationOf } from './hostFixture';
import { PlatformFacts } from './PlatformFacts';
import { processLayer } from './composition/macos';

const LIBRARY = resolve(import.meta.dir, '../native/target/release/libexecution_platform.dylib');
const policy = hostPolicy({ executions: 1, transports: ['pipes'] });
const limits: WireLimits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
const share = hostShare(policy, 1);
const directory = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = hostTestRoot();
  yield* fs.makeDirectory(root, { recursive: true });
  return yield* fs.makeTempDirectoryScoped({ directory: root, prefix: 'host-boot-' });
});
const platform = Layer.mergeAll(processLayer(LIBRARY), HostRegistration.layer, fixtureHolder()).pipe(Layer.provideMerge(BunServices.layer));

layer(platform, { excludeTestServices: true })('host boot', (it) => {
  it.effect(
    'serves its initialized profile when the process census answers after the old boot deadline',
    Effect.fnUntraced(function* () {
      const state = yield* directory;
      const registration = registrationOf(state);
      const environment = yield* Layer.build(
        platformLayer(LIBRARY).pipe(
          Layer.provideMerge(testHolder(state)),
          Layer.provideMerge(credentialsLayer(registration.credentials)),
          Layer.merge(endpointConnection),
        ),
      );
      yield* Effect.gen(function* () {
        const real = yield* ChildProcessSpawner.ChildProcessSpawner;
        const delayed = ChildProcessSpawner.make((command) =>
          command._tag === 'StandardCommand' && command.command === PS
            ? Effect.andThen(Effect.sleep('2100 millis'), real.spawn(command))
            : real.spawn(command),
        );
        const facts = yield* platformFacts(yield* loadLibrary(LIBRARY)).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, delayed),
        );
        const running = yield* Effect.forkScoped(
          serve({ state, registration, library: LIBRARY, policy, share, limits }).pipe(Effect.provideService(PlatformFacts, facts)),
        );
        const client = yield* ExecutionClient.make({
          address: { state, installation: registration.installation },
          role: 'custodian',
          limits,
        });
        const status = yield* Effect.raceFirst(
          client.status().pipe(
            Effect.retry({
              while: (failure) => failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable'),
              schedule: Schedule.spaced('25 millis'),
            }),
          ),
          Fiber.join(running).pipe(Effect.andThen(Effect.die(new Error('the host left before answering its status')))),
        );
        expect(status.phase).toBe('open');
        expect((yield* client.capabilities()).ceilings.executions).toBeGreaterThan(0);
      }).pipe(Effect.provide(environment));
    }),
  );

  it.effect(
    'a platform without optional kernel limits opens under its memory grant',
    Effect.fnUntraced(function* () {
      const state = yield* directory;
      const facts = fixtureFacts(policy);
      const built = yield* host({ state, registration: registrationOf(state), library: LIBRARY, policy, share, limits }).pipe(
        Effect.provideService(PlatformFacts, {
          ...facts,
          limits: Effect.succeed({ openFiles: 'absent', holderFiles: 'absent', processes: 'absent', terminals: 'absent' } as const),
        }),
      );
      expect(built.profile.ceilings.executions).toBeGreaterThan(0);
      expect(built.profile.ceilings.terminals).toBe(0);
      expect(built.profile.platform).toEqual(facts.identity.platform);
    }),
  );

  it.effect(
    'a bundle directory holding no manifest refuses typed instead of dying',
    Effect.fnUntraced(function* () {
      const state = yield* directory;
      const bundle = join(state, 'bundle');
      const failure = yield* Effect.flip(
        host({
          state,
          registration: registrationOf(state),
          library: join(state, 'libexecution_platform.dylib'),
          policy,
          share,
          limits,
          artifact: bundle,
        }).pipe(Effect.provideService(PlatformFacts, fixtureFacts(policy))),
      );
      expect(failure._tag).toBe('BootRefused');
      if (failure._tag === 'BootRefused') expect(failure.detail).toContain(bundle);
    }),
  );

  it.effect(
    'a registration naming paths outside the state directory refuses typed instead of dying',
    Effect.fnUntraced(function* () {
      const state = yield* directory;
      const outside = join('/elsewhere', 'host.sock');
      const registration = { ...registrationOf(state), endpoint: { transport: 'unix' as const, path: outside } };
      const failure = yield* Effect.flip(
        host({ state, registration, library: LIBRARY, policy, share, limits }).pipe(
          Effect.provideService(PlatformFacts, fixtureFacts(policy)),
        ),
      );
      expect(failure._tag).toBe('BootRefused');
      if (failure._tag === 'BootRefused') expect(failure.detail).toContain(outside);
    }),
  );
});
