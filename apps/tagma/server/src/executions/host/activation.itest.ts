import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Effect, Layer, Schema } from 'effect';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { digestOf, holderEntryOf, identityOf, stampOf, verifyArtifact } from '@runlith/executions/hostArtifacts';
import {
  ARTIFACT_FILE,
  HOLDER_ENTRY_FILE,
  ArtifactManifest,
  REQUIRED_ROLES,
  type ArtifactPart,
  type ArtifactStamp,
} from '@runlith/executions/protocol/artifact';
import { bootPath } from '@runlith/executions/protocol/boot';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { InstallationId } from '@runlith/executions/protocol/execution';
import { REGISTRATION_FILE, Registration } from '@runlith/executions/protocol/registration';
import { fixtureRoot } from '../../platform/testing/roots.js';
import { makeHostActivation, type SchemaOffer } from './activation.js';
import { bootInput, bootText } from './boot.js';
import { executionPolicy } from './policy.js';

const owned = fixtureRoot('host-activation', '');
mkdirSync(owned, { recursive: true });
const home = realpathSync(mkdtempSync(join(owned, 'a-')));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const bundle = join(home, 'pinned');
const encodeManifest = Schema.encodeSync(Schema.fromJsonString(ArtifactManifest));
const encodeRegistration = Schema.encodeSync(Schema.fromJsonString(Registration));
const level: SchemaOffer = { database: { applied: 4, latest: 'd' }, application: { applied: 4, latest: 'd' } };

mkdirSync(bundle);
const parts: ArtifactPart[] = REQUIRED_ROLES.map((role) => {
  const bytes = new TextEncoder().encode(`export const ${role} = true;\n`);
  const path = `${role}.js`;
  writeFileSync(join(bundle, path), bytes);
  return { role, path, bytes: bytes.length, digest: digestOf(bytes) };
});
const content = {
  protocol: 'executions/1' as const,
  platform: { os: 'darwin', arch: 'arm64' },
  endpoint: { transport: 'unix', path: 'host.sock' },
  wire: { min: 1, max: 1 },
  parts,
};
const declared = { ...content, identity: { digest: identityOf(content), build: 'fixture' } };
const entry = holderEntryOf(declared);
if (entry === undefined) throw new Error('the fixture has no launch roles');
writeFileSync(join(bundle, HOLDER_ENTRY_FILE), entry);
writeFileSync(join(bundle, ARTIFACT_FILE), encodeManifest(declared));

const pinnedOf = verifyArtifact(bundle);

const world = Effect.fnUntraced(function* (
  name: string,
  options: {
    readonly artifact?: ArtifactStamp | null;
    readonly policy?: ExecutionPolicy;
    readonly share?: number;
    readonly boot?: boolean;
  } = {},
) {
  const pinned = yield* pinnedOf;
  const state = join(home, name);
  mkdirSync(state);
  cpSync(bundle, join(state, 'bundle'), { recursive: true });
  const registration: Registration = {
    version: 1,
    state,
    installation: InstallationId.make('host-activation'),
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: join(state, 'host.sock') },
    credentials: { custodian: join(state, 'custodian.key'), recovery: join(state, 'recovery.key') },
    artifact: options.artifact === null ? undefined : (options.artifact ?? stampOf(pinned)),
  };
  writeFileSync(join(state, REGISTRATION_FILE), encodeRegistration(registration));
  const input = bootInput(state, registration, pinned, options.policy ?? executionPolicy);
  if (input === undefined) return yield* Effect.die('the fixture has no platform part');
  if (options.boot !== false) {
    writeFileSync(bootPath(state, pinned.identity.digest), bootText({ ...input, share: options.share ?? input.share }));
  }
  return state;
});

const accept = Effect.fnUntraced(function* (state: string, schema: SchemaOffer = level, offered: string = bundle) {
  const activation = yield* makeHostActivation;
  return yield* activation.adoption(offered, state, schema, executionPolicy, (yield* pinnedOf).identity.digest);
});

const another = { digest: digestOf(new TextEncoder().encode('another bundle')), build: 'another' };

layer(Layer.provideMerge(HostRegistration.layer, BunServices.layer), { excludeTestServices: true })('host activation', (it) => {
  it.effect('the published bundle and its unchanged boot input are accepted', () =>
    Effect.gen(function* () {
      const pinned = yield* pinnedOf;
      const answer = yield* accept(yield* world('unchanged'));
      expect(answer._tag).toBe('Adopt');
      if (answer._tag !== 'Adopt') return;
      expect(answer.standing.artifact?.identity.digest).toBe(pinned.identity.digest);
      expect(answer.offered.identity).toEqual(pinned.identity);
    }),
  );

  it.effect('another published digest refuses acceptance before reading a boot input', () =>
    Effect.gen(function* () {
      const pinned = yield* pinnedOf;
      const artifact = { ...stampOf(pinned), identity: another };
      expect(yield* accept(yield* world('different-bundle', { artifact, boot: false }))).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'BundleMismatch', standing: artifact.identity.digest, offered: pinned.identity.digest },
      });
    }),
  );

  it.effect('a different loading policy refuses the same bundle', () =>
    Effect.gen(function* () {
      const policy = {
        ...executionPolicy,
        execution: { ...executionPolicy.execution, geometry: { ...executionPolicy.execution.geometry, columns: 160, rows: 60 } },
      };
      expect(yield* accept(yield* world('different-policy', { policy }))).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'BootMismatch' },
      });
    }),
  );

  it.effect('a different loading memory share refuses the same bundle', () =>
    Effect.gen(function* () {
      expect(yield* accept(yield* world('different-share', { share: 0.5 }))).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'BootMismatch' },
      });
    }),
  );

  it.effect('a missing boot input is unproved rather than unchanged', () =>
    Effect.gen(function* () {
      expect(yield* accept(yield* world('missing-boot', { boot: false }))).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'BootUnusable' },
      });
    }),
  );

  it.effect('a host that published no bundle identity is not accepted', () =>
    Effect.gen(function* () {
      expect(yield* accept(yield* world('unpublished', { artifact: null }))).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'HostUnknown' },
      });
    }),
  );

  it.effect('an unreadable registration carries its own refusal', () =>
    Effect.gen(function* () {
      const state = yield* world('bad-registration');
      writeFileSync(join(state, REGISTRATION_FILE), '{ not json');
      expect(yield* accept(state)).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'RegistrationUnusable', refusal: { _tag: 'RegistrationInvalid' } },
      });
    }),
  );

  it.effect('a damaged proposed bundle is refused before a different host can be accepted', () =>
    Effect.gen(function* () {
      const offered = join(home, 'damaged');
      cpSync(bundle, offered, { recursive: true });
      writeFileSync(join(offered, 'host.js'), 'damaged');
      const artifact = { ...stampOf(yield* pinnedOf), identity: another };
      expect(yield* accept(yield* world('unproved-offer', { artifact }), level, offered)).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'OfferUnproved', refusal: { _tag: 'ArtifactInvalid', reason: 'mismatch' } },
      });
    }),
  );

  it.effect('a database ahead of or beside its shipped chain refuses adoption, while one behind it is accepted', () =>
    Effect.gen(function* () {
      const state = yield* world('schema');
      expect(yield* accept(state, { database: { applied: 6, latest: 'f' }, application: level.application })).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'SchemaAhead' },
      });
      expect(yield* accept(state, { database: { applied: 4, latest: 'other' }, application: level.application })).toMatchObject({
        _tag: 'Defer',
        reason: { _tag: 'SchemaDiverged' },
      });
      expect((yield* accept(state, { database: { applied: 2, latest: 'b' }, application: level.application }))._tag).toBe('Adopt');
    }),
  );
});
