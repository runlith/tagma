import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { identityOf } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE, ArtifactPart, REQUIRED_ROLES } from '@runlith/executions/protocol/artifact';
import { WIRE_VERSION } from '@runlith/executions/protocol/wire';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { hostBundleNext, swapBundle } from './offer.js';
import { hostBundle, type StateClaim } from './boot.js';

const owned = fixtureRoot('host-offer-swap', '');
mkdirSync(owned, { recursive: true });
const home = mkdtempSync(join(owned, 'c-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const manifestOf = (char: string, build: string): { text: string; digest: string } => {
  const parts = Schema.decodeUnknownSync(Schema.Array(ArtifactPart))(
    REQUIRED_ROLES.map((role, index) => ({ role, path: `part-${index}`, bytes: 1, digest: `sha256:${char.repeat(64)}` })),
  );
  const declared = {
    protocol: 'executions/1' as const,
    platform: { os: 'darwin', arch: 'arm64' },
    endpoint: { transport: 'unix', path: 'host.sock' },
    wire: { min: WIRE_VERSION, max: WIRE_VERSION },
    parts,
  };
  const digest = identityOf(declared);
  return { text: JSON.stringify({ identity: { digest, build }, ...declared }), digest };
};

const world = (name: string, standing: string | undefined, waiting: string | undefined): string => {
  const state = join(home, name);
  if (standing !== undefined) {
    mkdirSync(hostBundle(state), { recursive: true });
    writeFileSync(join(hostBundle(state), ARTIFACT_FILE), manifestOf(standing, `build-${standing}`).text);
  }
  if (waiting !== undefined) {
    mkdirSync(hostBundleNext(state), { recursive: true });
    writeFileSync(join(hostBundleNext(state), ARTIFACT_FILE), manifestOf(waiting, `build-${waiting}`).text);
  }
  return state;
};

const standingDigest = (state: string): string =>
  (JSON.parse(readFileSync(join(hostBundle(state), ARTIFACT_FILE), 'utf8')) as { identity: { digest: string } }).identity.digest;

const runSwap = (state: string, claim: Effect.Effect<StateClaim>) =>
  Effect.flatMap(FileSystem.FileSystem, (files) => swapBundle(files, state, claim));

layer(BunFileSystem.layer, { excludeTestServices: true })('the bundle swap', (it) => {
  it.effect('a waiting offer takes the place of the bundle in place', () =>
    Effect.gen(function* () {
      const state = world('swap', 'a', 'b');
      yield* runSwap(state, Effect.succeed({ _tag: 'Free' }));
      expect(existsSync(hostBundleNext(state))).toBe(false);
      expect(standingDigest(state)).toBe(manifestOf('b', 'build-b').digest);
    }),
  );

  it.effect('nothing waiting leaves the bundle in place, or the absence of one', () =>
    Effect.gen(function* () {
      const kept = world('idle-standing', 'a', undefined);
      yield* runSwap(kept, Effect.succeed({ _tag: 'Free' }));
      expect(standingDigest(kept)).toBe(manifestOf('a', 'build-a').digest);
      const bare = world('idle-bare', undefined, undefined);
      yield* runSwap(bare, Effect.succeed({ _tag: 'Free' }));
      expect(existsSync(hostBundle(bare))).toBe(false);
    }),
  );

  it.effect('a held claim leaves the offer waiting beside the bundle in place', () =>
    Effect.gen(function* () {
      const state = world('held', 'a', 'b');
      yield* runSwap(state, Effect.succeed({ _tag: 'Held', holders: [424242] }));
      expect(existsSync(hostBundleNext(state))).toBe(true);
      expect(standingDigest(state)).toBe(manifestOf('a', 'build-a').digest);
    }),
  );

  it.effect('an unreadable claim leaves the candidate and standing bundle unchanged', () =>
    Effect.gen(function* () {
      const state = world('unmeasured', 'a', 'b');
      yield* runSwap(state, Effect.succeed({ _tag: 'Unmeasured', detail: 'lsof would not run' }));
      expect(existsSync(hostBundleNext(state))).toBe(true);
      expect(standingDigest(state)).toBe(manifestOf('a', 'build-a').digest);
    }),
  );
});
