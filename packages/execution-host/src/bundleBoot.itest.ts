import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import * as BunServices from '@effect/platform-bun/BunServices';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { ExecutionClient, type Client } from '@runlith/executions/ExecutionClient';
import { boundTo, holderEntryOf, identityOf, pathOf, verifyArtifact } from '@runlith/executions/hostArtifacts';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { HOLDER_ENTRY_FILE, type ArtifactManifest, type ArtifactRole } from '@runlith/executions/protocol/artifact';
import { WIRE_RANGE } from '@runlith/executions/protocol/wire';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { buildArtifact, CARRIER_ENTRY, EVIDENCE_ENTRY, HOST_ENTRY, MIGRATIONS, RECOVERY_ENTRY, RUNTIME_PART } from './buildArtifact';
import { host } from './host';
import { fixtureHolder, fixtureFacts, hostPolicy, hostShare, hostWireLimits, registrationOf } from './hostFixture';
import { PlatformFacts } from './PlatformFacts';
import { processLayer } from './composition/macos';
import { HOLDER_BINARY, HOLDER_LIBRARY } from './posix/testing/holder';

const SOURCE = join(import.meta.dir, '..');
const CHECKOUT = join(SOURCE, '..', '..');
const policy = hostPolicy({ executions: 1, transports: ['pipes'] });
const limits = hostWireLimits(policy, 1, { envelopeBytes: 16384, connections: 2, requests: 4 });
const share = hostShare(policy, 1);
const encodeBoot = Schema.encodeEffect(Schema.fromJsonString(HostBoot));
const requiredPath = (root: string, manifest: ArtifactManifest, role: ArtifactRole) => {
  const path = pathOf(root, manifest, role);
  if (path === undefined) throw new Error(`the bundle has no ${role} role`);
  return path;
};
type Bundle = { readonly root: string; readonly manifest: ArtifactManifest; readonly state: string; readonly client: Client };
class BuiltBundle extends Context.Service<BuiltBundle, Bundle>()('test/BundleBoot/Bundle') {}
const fixture = Layer.effect(
  BuiltBundle,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const directory = yield* files.makeTempDirectoryScoped({ prefix: 'bundle-boot-' });
    const built = yield* buildArtifact({
      root: `${directory}/built`,
      source: SOURCE,
      library: HOLDER_LIBRARY,
      holder: HOLDER_BINARY,
      build: 'itest',
    });
    const root = `${directory}/moved`;
    yield* files.rename(built.root, root);
    const state = `${directory}/state`;
    yield* files.makeDirectory(state, { mode: 0o700 });
    const registration = registrationOf(state);
    const boot = `${state}/boot.json`;
    yield* files.writeFileString(
      boot,
      yield* encodeBoot({
        state,
        registration,
        library: requiredPath(root, built.manifest, 'platform'),
        policy,
        share,
        limits,
        artifact: root,
        lifetime: 'with-parent',
      }),
      { mode: 0o600 },
    );
    const child = yield* spawner.spawn(
      ChildProcess.make(requiredPath(root, built.manifest, 'holder'), [state, join(root, RUNTIME_PART), join(root, HOST_ENTRY), boot], {
        cwd: state,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    );
    let output = '';
    const note = (bytes: Uint8Array) =>
      Effect.sync(() => {
        output = (output + new TextDecoder().decode(bytes)).slice(-16_384);
      });
    yield* Effect.forkScoped(Stream.runForEach(child.stdout, note));
    yield* Effect.forkScoped(Stream.runForEach(child.stderr, note));
    const client = yield* ExecutionClient.make({ address: { state, installation: registration.installation }, role: 'custodian', limits });
    yield* Effect.raceFirst(
      client.status().pipe(
        Effect.retry({
          while: (failure) => failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable'),
          schedule: Schedule.spaced('25 millis'),
        }),
      ),
      Effect.flatMap(child.exitCode, (code) => Effect.die(new Error(`the bundled host exited ${code} before answering: ${output}`))),
    );
    return { root, manifest: built.manifest, state, client } satisfies Bundle;
  }),
).pipe(Layer.provideMerge(HostRegistration.layer), Layer.provideMerge(endpointConnection), Layer.provideMerge(BunServices.layer));
type CommandInput = { readonly program: string; readonly args: readonly string[]; readonly cwd: string };
const command = Effect.fnUntraced(function* ({ program, args, cwd }: CommandInput) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(program, args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const [stdout, stderr, code] = yield* Effect.all(
    [
      Stream.runCollect(child.stdout).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString())),
      Stream.runCollect(child.stderr).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString())),
      child.exitCode,
    ],
    { concurrency: 3 },
  );
  return { stdout, stderr, code };
}, Effect.scoped);

layer(fixture, { excludeTestServices: true, timeout: '30 seconds' })('a bundle this repository produces', (it) => {
  it.effect('carries and verifies the complete relocated closure with its declared platform and wire contracts', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const files = yield* FileSystem.FileSystem;
      const verified = yield* verifyArtifact(built.root);
      expect(verified.identity.digest).toBe(built.manifest.identity.digest);
      expect([...new Set(verified.parts.map((part) => part.role))].sort()).toEqual([
        'carrier',
        'evidence',
        'holder',
        'host',
        'metadata',
        'platform',
        'recovery',
        'runtime',
        'sampler',
      ]);
      for (const part of verified.parts) expect(Number((yield* files.stat(join(built.root, part.path))).size)).toBe(part.bytes);
      const schema = verified.parts.filter((part) => part.path.startsWith(`${MIGRATIONS}/`));
      expect(schema.length).toBeGreaterThan(0);
      expect(schema.every((part) => part.role === 'metadata')).toBe(true);
      expect(verified.platform).toEqual({ os: process.platform, arch: process.arch });
      expect(verified.endpoint).toEqual({ transport: 'unix', path: 'host.sock' });
      expect(verified.wire).toEqual(WIRE_RANGE);
      expect(verified.commands).toEqual([{ transport: 'pipes', relations: ['leader', 'work', 'ancestry'] }]);
    }),
  );

  it.effect('refuses a manifest claiming command coverage the selected backend cannot supply, before publishing state', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const files = yield* FileSystem.FileSystem;
      const directory = yield* files.makeTempDirectoryScoped({ prefix: 'bundle-coverage-' });
      const root = `${directory}/bundle`;
      const state = `${directory}/state`;
      const claimed: ArtifactManifest = { ...built.manifest, commands: [{ transport: 'pipes', relations: ['leader', 'ancestry'] }] };
      yield* files.copy(built.root, root);
      const manifest = { ...claimed, identity: { ...claimed.identity, digest: identityOf(claimed) } };
      const entry = holderEntryOf(manifest);
      if (entry === undefined) return yield* Effect.die(new Error('the fixture has no launch roles'));
      yield* files.writeFileString(`${root}/artifact.json`, JSON.stringify(manifest));
      yield* files.writeFileString(join(root, HOLDER_ENTRY_FILE), entry);
      expect((yield* verifyArtifact(root)).commands).toEqual(claimed.commands);
      const refused = yield* Effect.flip(
        Effect.scoped(
          host({
            state,
            registration: registrationOf(state),
            library: requiredPath(root, claimed, 'platform'),
            policy,
            share,
            limits,
            artifact: root,
          }).pipe(
            Effect.provideService(PlatformFacts, fixtureFacts(policy)),
            Effect.provide(fixtureHolder()),
            Effect.provide(processLayer(HOLDER_LIBRARY)),
          ),
        ),
      );
      expect(refused._tag).toBe('BootRefused');
      expect(yield* files.exists(`${state}/registration.json`)).toBe(false);
    }),
  );

  it.effect('contains no absolute checkout path in its programs or manifest', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const files = yield* FileSystem.FileSystem;
      for (const path of [HOST_ENTRY, CARRIER_ENTRY, EVIDENCE_ENTRY, RECOVERY_ENTRY, 'artifact.json'])
        expect(yield* files.readFileString(join(built.root, path))).not.toContain(CHECKOUT);
    }),
  );

  it.effect('the relocated host serves from its own parts and publishes the artifact identity it proved', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const registrations = yield* HostRegistration;
      expect(yield* boundTo(built.root, built.manifest, 'platform', requiredPath(built.root, built.manifest, 'platform'))).toBe(true);
      const published = yield* registrations.read(built.state);
      const status = yield* built.client.status();
      expect(published.artifact?.identity.digest).toBe(built.manifest.identity.digest);
      expect(published.artifact?.range).toEqual(WIRE_RANGE);
      expect(status.installation).toBe(published.installation);
    }),
  );

  it.effect('a compiled host rejects a platform library outside its bundle before publishing registration or creating its database', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'bundle-unbound-' });
      const boot = `${state}/boot.json`;
      expect(yield* boundTo(built.root, built.manifest, 'platform', HOLDER_LIBRARY)).toBe(false);
      yield* files.writeFileString(
        boot,
        yield* encodeBoot({
          state,
          registration: registrationOf(state),
          library: HOLDER_LIBRARY,
          policy,
          share,
          limits,
          artifact: built.root,
        }),
        { mode: 0o600 },
      );
      const refused = yield* command({
        program: requiredPath(built.root, built.manifest, 'holder'),
        args: [state, join(built.root, RUNTIME_PART), join(built.root, HOST_ENTRY), boot],
        cwd: state,
      });
      expect(Number(refused.code)).not.toBe(0);
      expect(yield* files.exists(`${state}/registration.json`)).toBe(false);
      expect(yield* files.exists(`${state}/executions.sqlite`)).toBe(false);
    }),
  );

  it.effect('the packaged recovery program reads the running bundle identity from outside the checkout', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      const status = yield* command({
        program: join(built.root, RUNTIME_PART),
        args: [join(built.root, RECOVERY_ENTRY), built.state, 'status'],
        cwd: '/tmp',
      });
      expect(Number(status.code)).toBe(0);
      expect(status.stdout).toContain(built.manifest.identity.digest);
    }),
  );

  it.effect('never rebuilds an existing bundle root in place', () =>
    Effect.gen(function* () {
      const built = yield* BuiltBundle;
      expect(
        yield* Effect.flip(
          buildArtifact({ root: built.root, source: SOURCE, library: HOLDER_LIBRARY, holder: HOLDER_BINARY, build: 'second' }),
        ),
      ).toMatchObject({ _tag: 'BuildRefused', part: 'artifact.json' });
      expect((yield* verifyArtifact(built.root)).identity.digest).toBe(built.manifest.identity.digest);
    }),
  );
});
