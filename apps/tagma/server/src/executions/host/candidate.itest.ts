import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Schema } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { digestOf, holderEntryOf, identityOf } from '@runlith/executions/hostArtifacts';
import {
  ARTIFACT_FILE,
  ArtifactContent,
  type ArtifactManifest,
  HOLDER_ENTRY_FILE,
  REQUIRED_ROLES,
} from '@runlith/executions/protocol/artifact';
import { bootPath } from '@runlith/executions/protocol/boot';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { WIRE_VERSION } from '@runlith/executions/protocol/wire';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { bootInput, bootText, hostBundle } from './boot.js';
import { hostBootNext, hostBundleNext, placeCandidate, promoteBoot, withdrawCandidate } from './offer.js';
import { executionPolicy } from './policy.js';

const owned = fixtureRoot('host-candidate', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'c-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const services = HostRegistration.layer.pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, BunPath.layer)));

const bundleAt = (root: string, flavour: string): ArtifactManifest => {
  mkdirSync(root, { recursive: true });
  const parts = REQUIRED_ROLES.map((role) => {
    const bytes = new TextEncoder().encode(`${role} ${flavour}`);
    writeFileSync(join(root, `${role}.bin`), bytes);
    return { role, path: `${role}.bin`, bytes: bytes.length, digest: digestOf(bytes) };
  });
  const content = Schema.decodeUnknownSync(ArtifactContent)({
    protocol: 'executions/1',
    platform: { os: process.platform, arch: process.arch },
    endpoint: { transport: 'unix', path: 'host.sock' },
    wire: { min: WIRE_VERSION, max: WIRE_VERSION },
    parts,
  });
  const manifest = { identity: { digest: identityOf(content), build: flavour }, ...content };
  writeFileSync(join(root, ARTIFACT_FILE), JSON.stringify(manifest));
  writeFileSync(join(root, HOLDER_ENTRY_FILE), holderEntryOf(manifest) ?? '');
  return manifest;
};

const otherPolicy: ExecutionPolicy = { ...executionPolicy, host: { ...executionPolicy.host, bindings: executionPolicy.host.bindings + 1 } };

const world = Effect.fnUntraced(function* (name: string, policy: ExecutionPolicy = executionPolicy) {
  const root = join(home, name);
  const state = join(root, 'state');
  const standing = bundleAt(hostBundle(state), 'a');
  const published = yield* (yield* HostRegistration).publish(state, {
    installation: InstallationId.make('candidate-test'),
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: join(state, 'host.sock') },
    credentials: { custodian: join(state, 'custodian'), recovery: join(state, 'recovery') },
  });
  const boot = bootInput(state, published.registration, standing, policy);
  if (boot === undefined) return yield* Effect.die('the fixture bundle names no platform part');
  writeFileSync(bootPath(state, standing.identity.digest), bootText(boot));
  return { root, state, standing, own: join(root, 'own') };
});

const place = Effect.fnUntraced(function* (state: string, own: string, closure: string) {
  return yield* placeCandidate({
    files: yield* FileSystem.FileSystem,
    registrations: yield* HostRegistration,
    source: { _tag: 'Closure', path: closure },
    own,
    state,
    restart: 'restart-itest',
  });
});

const digestAt = (root: string): string =>
  (JSON.parse(readFileSync(join(root, ARTIFACT_FILE), 'utf8')) as { identity: { digest: string } }).identity.digest;

layer(services, { excludeTestServices: true })('host candidate', (it) => {
  it.effect('a successor carrying the standing bundle and boot input places nothing and copies nothing', () =>
    Effect.gen(function* () {
      const { root, state, standing, own } = yield* world('same');
      const closure = join(root, 'closure');
      cpSync(hostBundle(state), closure, { recursive: true });

      const files = yield* FileSystem.FileSystem;
      const ended = join(state, 'boot-ended.stderr');
      const active = join(state, 'boot-active.stderr');
      yield* files.writeFileString(ended, 'an ended attempt');
      yield* files.writeFileString(`${ended}.writing`, '');
      yield* files.writeFileString(`${active}.writing`, '');
      const placed = yield* withFileLock(active, 0, () => place(state, own, closure));

      expect(placed).toEqual(expect.objectContaining({ _tag: 'Standing', digest: standing.identity.digest }));
      expect([existsSync(own), existsSync(hostBundleNext(state)), existsSync(hostBootNext(state))]).toEqual([false, false, false]);
      expect([existsSync(ended), existsSync(`${ended}.writing`)]).toEqual([false, false]);
      expect([existsSync(active), existsSync(`${active}.writing`)]).toEqual([true, true]);
      yield* place(state, own, closure);
      expect([existsSync(active), existsSync(`${active}.writing`)]).toEqual([false, false]);
    }),
  );

  it.effect('another bundle waits beside the standing one with its own boot input, and once it stands it is not placed again', () =>
    Effect.gen(function* () {
      const { root, state, standing, own } = yield* world('other');
      const offered = bundleAt(join(root, 'closure'), 'b');

      const placed = yield* place(state, own, join(root, 'closure'));

      expect(placed).toEqual(expect.objectContaining({ _tag: 'Placed', digest: offered.identity.digest, bundle: true }));
      expect(digestAt(hostBundle(state))).toBe(standing.identity.digest);
      expect(digestAt(hostBundleNext(state))).toBe(offered.identity.digest);
      expect(existsSync(bootPath(state, offered.identity.digest))).toBe(true);
      expect(existsSync(bootPath(state, standing.identity.digest))).toBe(true);

      renameSync(hostBundle(state), `${hostBundle(state)}.prior`);
      renameSync(hostBundleNext(state), hostBundle(state));
      const again = yield* place(state, own, join(root, 'closure'));

      expect(again).toEqual(expect.objectContaining({ _tag: 'Standing', digest: offered.identity.digest }));
      expect([existsSync(hostBundleNext(state)), existsSync(bootPath(state, standing.identity.digest))]).toEqual([false, false]);
    }),
  );

  it.effect('the same bundle under another policy places only a boot candidate, which the leaving predecessor puts in place', () =>
    Effect.gen(function* () {
      const { root, state, standing, own } = yield* world('policy', otherPolicy);
      const closure = join(root, 'closure');
      cpSync(hostBundle(state), closure, { recursive: true });

      const placed = yield* place(state, own, closure);
      const candidate = readFileSync(hostBootNext(state), 'utf8');
      const prior = readFileSync(bootPath(state, standing.identity.digest), 'utf8');
      const restore = yield* promoteBoot(yield* FileSystem.FileSystem, state);

      expect(placed).toEqual(expect.objectContaining({ _tag: 'Placed', digest: standing.identity.digest, bundle: false }));
      expect(existsSync(hostBundleNext(state))).toBe(false);
      expect(existsSync(hostBootNext(state))).toBe(false);
      expect(readFileSync(bootPath(state, standing.identity.digest), 'utf8')).toBe(candidate);

      yield* restore;
      expect(readFileSync(bootPath(state, standing.identity.digest), 'utf8')).toBe(prior);
    }),
  );

  it.effect('a bundle that does not verify is refused, and the standing bundle stays the only one', () =>
    Effect.gen(function* () {
      const { root, state, standing, own } = yield* world('broken');
      const closure = join(root, 'closure');
      bundleAt(closure, 'c');
      writeFileSync(join(closure, 'host.bin'), 'host changed after its digest was taken');

      const refused = yield* Effect.flip(place(state, own, closure));

      expect(refused._tag).toBe('HostPreparationRefused');
      expect([existsSync(own), existsSync(hostBundleNext(state))]).toEqual([false, false]);
      expect(digestAt(hostBundle(state))).toBe(standing.identity.digest);
    }),
  );

  it.effect('a withdrawn candidate leaves with its boot input, and the standing boot input stays', () =>
    Effect.gen(function* () {
      const { root, state, standing, own } = yield* world('withdrawn');
      const offered = bundleAt(join(root, 'closure'), 'b');
      yield* place(state, own, join(root, 'closure'));

      yield* withdrawCandidate(yield* FileSystem.FileSystem, state);

      expect([existsSync(hostBundleNext(state)), existsSync(bootPath(state, offered.identity.digest))]).toEqual([false, false]);
      expect(existsSync(bootPath(state, standing.identity.digest))).toBe(true);
    }),
  );
});
