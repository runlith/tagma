import { afterAll, describe, expect } from 'bun:test';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { it, layer } from '@runlith/effect-test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Clock, Deferred, Effect, Fiber, FileSystem, Layer, Ref, Schedule } from 'effect';
import { TestClock } from 'effect/testing';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { REGISTRATION_FILE, Registration } from '@runlith/executions/protocol/registration';
import { digestOf, identityOf } from '@runlith/executions/hostArtifacts';
import {
  type ArtifactPart,
  type ArtifactPlatform,
  ArtifactManifest,
  ARTIFACT_FILE,
  REQUIRED_ROLES,
} from '@runlith/executions/protocol/artifact';
import { Schema } from 'effect';
import { bootPath, HostBoot as HostBootFile } from '@runlith/executions/protocol/boot';
import { existsSync, readFileSync } from 'node:fs';
import { WireFailed, WireUnreadable, WireUnavailable } from '@runlith/executions/Executions';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { hostPresence, raiseHost, type StateClaim } from './boot.js';
import { executionPolicy } from './policy.js';

const unreachable = new WireUnavailable({ kind: 'unreachable', reason: 'the socket could not be opened', sent: false });
const unreadable = new WireUnreadable({ detail: 'Expected "granted" in profile' });
const refusedHello = new WireFailed({ fault: { kind: 'malformed', detail: 'v: expected 1' } });

const services = HostRegistration.layer.pipe(Layer.provideMerge(BunServices.layer));

const free: Effect.Effect<StateClaim> = Effect.succeed({ _tag: 'Free' });

describe('hostPresence', () => {
  it.effect('a decoded answer is a host answering', () =>
    Effect.gen(function* () {
      expect((yield* hostPresence(Effect.succeed({})))._tag).toBe('Answering');
    }),
  );

  it.effect('a socket nothing listens on is absent, with what the socket said', () =>
    Effect.gen(function* () {
      const presence = yield* hostPresence(Effect.fail(unreachable));
      expect(presence._tag).toBe('Absent');
      if (presence._tag !== 'Absent') return;
      expect(presence.detail).toContain('unreachable');
    }),
  );

  it.effect('an invalid registered endpoint is no vacant address to start over', () =>
    Effect.gen(function* () {
      const invalid = new WireUnavailable({ kind: 'invalid', reason: 'unsupported transport', sent: false });
      expect((yield* hostPresence(Effect.fail(invalid)))._tag).toBe('Unsettled');
    }),
  );

  it.effect('a welcome this server cannot read, and a hello the host refused, are a host that is there', () =>
    Effect.gen(function* () {
      for (const failure of [unreadable, refusedHello]) {
        expect((yield* hostPresence(Effect.fail(failure)))._tag).toBe('Unspoken');
      }
    }),
  );
});

const launchRoot = fixtureRoot('host-launch', '');
afterAll(() => rmSync(launchRoot, { recursive: true, force: true }));

const STAYING_HOLDER = [
  '#!/bin/sh',
  'printf \'%s\\n\' "$2" "$3" "$4" > "$1/argv"',
  'while [ ! -e "$1/released" ]; do sleep 0.05; done',
  '',
].join('\n');

const launchBundle = (
  name: string,
  platform: ArtifactPlatform = { os: process.platform, arch: process.arch },
  holder: string | Uint8Array = STAYING_HOLDER,
  runtime = 'runtime',
) => {
  const state = join(launchRoot, name);
  const bundle = join(state, 'bundle');
  mkdirSync(bundle, { recursive: true });
  const parts: ArtifactPart[] = REQUIRED_ROLES.map((role) => {
    const path = `chosen-${role}`;
    const content = role === 'holder' ? holder : role === 'runtime' ? runtime : role;
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    writeFileSync(join(bundle, path), bytes, { mode: 0o700 });
    return { role, path, bytes: bytes.length, digest: digestOf(bytes) };
  });
  const declared = {
    protocol: 'executions/1' as const,
    platform,
    endpoint: { transport: 'unix', path: 'chosen.sock' },
    wire: { min: 1, max: 1 },
    parts,
  };
  writeFileSync(
    join(bundle, ARTIFACT_FILE),
    Schema.encodeSync(Schema.fromJsonString(ArtifactManifest))({
      identity: { digest: identityOf(declared), build: name },
      ...declared,
    }),
  );
  return {
    address: { state, installation: InstallationId.make(name), digest: identityOf(declared) },
    digest: identityOf(declared),
    bundle,
    released: Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        yield* files.writeFileString(join(state, 'released'), '');
        const diagnostics = (yield* files.readDirectory(state)).filter((name) => name.endsWith('.stderr'));
        yield* Effect.forEach(diagnostics, (name) =>
          withFileLock(join(state, name), 0, () => Effect.succeed(true)).pipe(
            Effect.catchTag('LockBusy', () => Effect.succeed(false)),
            Effect.repeat({ until: (free) => free, schedule: Schedule.spaced('10 millis') }),
          ),
        );
      }).pipe(Effect.provideService(Clock.Clock, Clock.Clock.defaultValue()), Effect.orDie),
    ),
  };
};

layer(services, { excludeTestServices: true })('raiseHost', (it) => {
  it.effect('a bundle for another OS or architecture is refused before its holder or boot file runs', () =>
    Effect.gen(function* () {
      const foreign = { os: process.platform === 'darwin' ? 'linux' : 'darwin', arch: process.arch };
      for (const [name, platform] of [
        ['os', foreign],
        ['arch', { os: process.platform, arch: 'another-arch' }],
      ] as const) {
        const world = launchBundle(name, platform);
        const outcome = yield* raiseHost({
          address: world.address,
          files: yield* FileSystem.FileSystem,
          registrations: yield* HostRegistration,
          policy: executionPolicy,
          status: Effect.fail(unreachable),
          claim: Effect.die('the writer claim is not read for a bundle this platform cannot run'),
          swap: Effect.void,
        });
        expect(outcome).toEqual({ _tag: 'UnsupportedPlatform', platform: { os: process.platform, arch: process.arch }, offered: platform });
        expect(existsSync(join(world.address.state, 'boot.json'))).toBe(false);
        expect(existsSync(join(world.address.state, 'argv'))).toBe(false);
      }
    }),
  );

  it.effect('raising uses the manifest roles and first endpoint, then preserves an existing registration', () =>
    Effect.gen(function* () {
      const registry = yield* HostRegistration;
      const fs = yield* FileSystem.FileSystem;
      for (const existing of [false, true]) {
        const world = launchBundle(existing ? 'registered' : 'first');
        yield* world.released;
        const { state, installation } = world.address;
        const registered = {
          installation,
          protocol: 'executions/1' as const,
          endpoint: { transport: 'unix', path: join(state, 'standing.sock') },
          credentials: { custodian: join(state, 'standing-custodian'), recovery: join(state, 'standing-recovery') },
        };
        if (existing) yield* registry.publish(state, registered);
        const argv = join(state, 'argv');
        const status = Effect.flatMap(fs.exists(argv).pipe(Effect.orDie), (up) => (up ? Effect.succeed({}) : Effect.fail(unreachable)));
        const outcome = yield* raiseHost({
          address: world.address,
          files: fs,
          registrations: registry,
          policy: executionPolicy,
          status,
          claim: free,
          swap: Effect.void,
        });
        expect(outcome._tag).toBe('Raised');
        const bootFile = bootPath(state, world.digest);
        const boot = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(HostBootFile))(readFileSync(bootFile, 'utf8'));
        expect(readFileSync(argv, 'utf8').trim().split('\n')).toEqual([
          join(world.bundle, 'chosen-runtime'),
          join(world.bundle, 'chosen-host'),
          bootFile,
        ]);
        expect(boot.library).toBe(join(world.bundle, 'chosen-platform'));
        expect(boot.registration.endpoint).toEqual(
          existing ? registered.endpoint : { transport: 'unix', path: join(state, 'chosen.sock') },
        );
        if (existing) expect(boot.registration.credentials).toEqual(registered.credentials);
      }
    }),
  );

  it.effect('a raise outlasts what the previous host left registered until the raised host answers', () =>
    Effect.gen(function* () {
      const world = launchBundle('stale');
      yield* world.released;
      const fs = yield* FileSystem.FileSystem;
      const registry = yield* HostRegistration;
      const { state, installation } = world.address;
      const previous = yield* registry.publish(state, {
        installation,
        protocol: 'executions/1',
        endpoint: { transport: 'unix', path: join(state, 'standing.sock') },
        credentials: { custodian: join(state, 'custodian'), recovery: join(state, 'recovery') },
      });
      const registration = previous.registration;
      const prior = {
        ...registration,
        artifact: {
          identity: { digest: digestOf(new TextEncoder().encode('previous-host')), build: 'previous' },
          protocol: 'executions/1' as const,
          wire: 1,
        },
      };
      const encode = Schema.encodeSync(Schema.fromJsonString(Registration));
      writeFileSync(join(registration.state, REGISTRATION_FILE), encode(prior));

      const rejected = yield* Deferred.make<void>();
      const published = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          yield* Deferred.await(rejected);
          yield* fs.writeFileString(
            join(registration.state, REGISTRATION_FILE),
            encode({ ...prior, artifact: { ...prior.artifact, identity: { digest: world.digest, build: 'stale' } } }),
          );
          yield* Deferred.succeed(published, undefined);
        }).pipe(Effect.orDie),
      );
      const status = Effect.gen(function* () {
        const current = yield* registry.read(state).pipe(Effect.orDie);
        if (current.artifact?.identity.digest === world.digest) return {};
        yield* Deferred.succeed(rejected, undefined);
        yield* Deferred.await(published);
        return yield* new WireUnavailable({ kind: 'mismatched', reason: 'the registration names the previous host', sent: false });
      });
      const outcome = yield* raiseHost({
        address: world.address,
        files: fs,
        registrations: registry,
        policy: executionPolicy,
        status,
        claim: free,
        swap: Effect.void,
      });
      expect(outcome._tag).toBe('Raised');
      expect((yield* registry.read(state)).artifact?.identity.digest).toBe(world.digest);
    }),
  );

  it.effect('a holder that ends before its host answers refuses the raise with how it ended', () =>
    Effect.gen(function* () {
      const world = launchBundle(
        'ended',
        undefined,
        '#!/bin/sh\nprintf "boot rejected its launch input\\n" >&2\nprintf "credentials refused the state directory\\n"\nexit 3\n',
      );
      const outcome = yield* raiseHost({
        address: world.address,
        files: yield* FileSystem.FileSystem,
        registrations: yield* HostRegistration,
        policy: executionPolicy,
        status: Effect.fail(unreachable),
        claim: free,
        swap: Effect.void,
      });
      expect(outcome._tag).toBe('Unraised');
      if (outcome._tag !== 'Unraised') return;
      expect(outcome.reason).toContain('exit 3');
      expect(outcome.reason).toContain('boot rejected its launch input');
      expect(outcome.reason).toContain('credentials refused the state directory');
    }),
  );

  it.effect('a live holder bounds all logic output while its caller holds no copy of the output fd', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const native = join(import.meta.dir, '../../../../../../packages/execution-host/native/target/release/execution-holder');
      const runtime = [
        '#!/bin/sh',
        'state="${2%/*}"',
        'i=0; while [ $i -lt 256 ]; do printf "%1024s" x; i=$((i+1)); done',
        'printf "last logic output\\n" >&2',
        'printf ready > "$state/ready"',
        'while [ ! -e "$state/released" ]; do sleep 0.01; done',
        'exit 3',
        '',
      ].join('\n');
      const world = launchBundle('bounded', undefined, readFileSync(native), runtime);
      let output: string | undefined;
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* files.writeFileString(join(world.address.state, 'released'), '');
          const path = output;
          if (path === undefined) return;
          while (!(yield* withFileLock(path, 0, () => Effect.succeed(true)).pipe(Effect.catchTag('LockBusy', () => Effect.succeed(false)))))
            yield* Effect.sleep(10);
        }).pipe(Effect.orDie),
      );
      const status = Effect.flatMap(files.exists(join(world.address.state, 'ready')).pipe(Effect.orDie), (ready) =>
        ready ? Effect.succeed({}) : Effect.fail(unreachable),
      );
      expect(
        yield* raiseHost({
          address: world.address,
          files,
          registrations: yield* HostRegistration,
          policy: executionPolicy,
          status,
          claim: free,
          swap: Effect.void,
        }),
      ).toEqual({ _tag: 'Raised' });
      const name = (yield* files.readDirectory(world.address.state)).find((name) => name.endsWith('.stderr'));
      if (name === undefined) return yield* Effect.die(new Error('the holder published no diagnostic output file'));
      output = join(world.address.state, name);
      let captured = '';
      do {
        captured = yield* files.readFileString(output);
        if (!captured.includes('last logic output')) yield* Effect.sleep(10);
      } while (!captured.includes('last logic output'));
      const held = yield* withFileLock(output, 0, () => Effect.succeed(false)).pipe(
        Effect.catchTag('LockBusy', () => Effect.succeed(true)),
      );
      expect(held).toBe(true);
      expect(Buffer.byteLength(captured)).toBeLessThanOrEqual(16 * 1024);
      expect(captured).toContain('last logic output');
    }),
  );

  it.effect('a held writer claim refuses a second holder even when the offered bundle is readable', () =>
    Effect.gen(function* () {
      const world = launchBundle('held');
      const outcome = yield* raiseHost({
        address: world.address,
        files: yield* FileSystem.FileSystem,
        registrations: yield* HostRegistration,
        policy: executionPolicy,
        status: Effect.fail(unreachable),
        claim: Effect.succeed({ _tag: 'Held', holders: [1] }),
        swap: Effect.void,
      });
      expect(outcome._tag).toBe('Unraised');
      expect(existsSync(join(world.address.state, 'argv'))).toBe(false);
      expect(existsSync(bootPath(world.address.state, world.digest))).toBe(false);
    }),
  );
});

layer(services)('raiseHost on a slow machine', (it) => {
  it.effect('a host that answers minutes after its holder started is waited for while the holder lives', () =>
    Effect.gen(function* () {
      const world = launchBundle('slow');
      yield* world.released;
      const up = yield* Ref.make(false);
      const asked = yield* Deferred.make<void>();
      const status = Effect.andThen(
        Deferred.succeed(asked, undefined),
        Effect.flatMap(Ref.get(up), (answering) => (answering ? Effect.succeed({}) : Effect.fail(unreachable))),
      );
      const raising = yield* Effect.forkChild(
        raiseHost({
          address: world.address,
          files: yield* FileSystem.FileSystem,
          registrations: yield* HostRegistration,
          policy: executionPolicy,
          status,
          claim: free,
          swap: Effect.void,
        }),
      );
      while (!(yield* Deferred.isDone(asked))) {
        yield* TestClock.withLive(Effect.sleep('10 millis'));
        yield* TestClock.adjust('100 millis');
      }
      yield* TestClock.adjust('10 minutes');
      yield* Ref.set(up, true);
      yield* TestClock.adjust('100 millis');
      expect(yield* Fiber.join(raising)).toEqual({ _tag: 'Raised' });
    }),
  );
});
