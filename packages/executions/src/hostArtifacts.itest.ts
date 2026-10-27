import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, PlatformError, Schema } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { digestOf, holderEntryOf, identityOf, boundTo, partOf, pathOf, readArtifact, verifyArtifact } from './hostArtifacts';
import { ARTIFACT_FILE, HOLDER_ENTRY_FILE, ArtifactManifest, type ArtifactPart } from './protocol/artifact';

const made: Array<string> = [];
const open = (): string => {
  const root = join(tmpdir(), 'runlith-executions');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'artifacts-'));
  made.push(directory);
  return directory;
};
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

const encodeManifest = Schema.encodeSync(Schema.fromJsonString(ArtifactManifest));
const text = new TextEncoder();

const wrote = (root: string, role: ArtifactPart['role'], path: string, content: string): ArtifactPart => {
  const bytes = text.encode(content);
  writeFileSync(join(root, path), bytes, { mode: 0o600 });
  return { role, path, bytes: bytes.length, digest: digestOf(bytes) };
};

const bundle = (): string => {
  const root = open();
  const parts: ReadonlyArray<ArtifactPart> = [
    wrote(root, 'runtime', 'bun', '#!/bin/sh\nexit 0\n'),
    wrote(root, 'holder', 'execution-holder', '#!/bin/sh\nexit 0\n'),
    wrote(root, 'host', 'host.js', 'export const serve = () => undefined;\n'),
    wrote(root, 'evidence', 'chunk.js', 'export const helper = 1;\n'),
    wrote(root, 'platform', 'libexecution_platform.dylib', 'not really a library, but really these bytes\n'),
    wrote(root, 'carrier', 'sqlite-process.js', 'export const carrier = true;\n'),
    wrote(root, 'evidence', 'worker.js', 'export const evidence = true;\n'),
    wrote(root, 'sampler', 'usageSampler.js', 'export const sampler = true;\n'),
    wrote(root, 'recovery', 'recovery.js', 'export const recover = () => undefined;\n'),
  ];
  const declared = {
    protocol: 'executions/1' as const,
    platform: { os: 'darwin', arch: 'arm64' },
    endpoint: { transport: 'unix', path: 'host.sock' },
    wire: { min: 1, max: 1 },
    parts,
  };
  const manifest = { identity: { digest: identityOf(declared), build: 'fixture' }, ...declared };
  const entry = holderEntryOf(manifest);
  if (entry === undefined) throw new Error('the fixture has no launch roles');
  writeFileSync(join(root, HOLDER_ENTRY_FILE), entry, { mode: 0o600 });
  writeFileSync(join(root, ARTIFACT_FILE), encodeManifest(manifest), { mode: 0o600 });
  return root;
};

class Pinned extends Context.Service<Pinned, string>()('executions/testing/Pinned') {}

const copy = (pinned: string): string => {
  const root = open();
  cpSync(pinned, root, { recursive: true });
  return root;
};

layer(Layer.merge(BunServices.layer, Layer.sync(Pinned, bundle)), { excludeTestServices: true })('a pinned host artifact', (it) => {
  it.effect('holder argv metadata is derived from the manifest and cannot be rewritten or omitted', () =>
    Effect.gen(function* () {
      const pinned = yield* Pinned;
      const changed = copy(pinned);
      yield* readArtifact(changed);
      writeFileSync(join(changed, HOLDER_ENTRY_FILE), 'holder another-program\n');
      const refused = yield* Effect.flip(verifyArtifact(changed));
      expect(refused).toMatchObject({ _tag: 'ArtifactInvalid', reason: 'mismatch', path: HOLDER_ENTRY_FILE });
      yield* readArtifact(changed);
      const missing = copy(pinned);
      rmSync(join(missing, HOLDER_ENTRY_FILE));
      expect(yield* Effect.flip(verifyArtifact(missing))).toMatchObject({ _tag: 'ArtifactUnreadable', path: HOLDER_ENTRY_FILE });
    }),
  );

  it.effect('a manifest without a holder keeps its published identity and recovery path when inspected', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const found = yield* readArtifact(root);
      const parts = found.parts.filter((part) => part.role !== 'holder');
      const declared = { ...found, parts };
      const published = digestOf(
        text.encode(
          [
            'protocol executions/1',
            'platform ["darwin","arm64"]',
            'endpoint ["unix","host.sock"]',
            'wire 1 1',
            'record 2',
            'metadata 1',
            ...parts.map((part) => `part ${part.role} ${part.path} ${part.digest}`).sort(),
          ].join('\n'),
        ),
      );
      rmSync(join(root, 'execution-holder'));
      writeFileSync(
        join(root, ARTIFACT_FILE),
        JSON.stringify({ ...declared, identity: { digest: published, build: 'before-holder' }, formats: { record: 2, metadata: 1 } }),
      );

      const inspected = yield* readArtifact(root);
      expect(inspected.identity.digest).toBe(published);
      expect(partOf(inspected, 'holder')).toBeUndefined();
      expect(pathOf(root, inspected, 'recovery')).toBe(join(root, 'recovery.js'));
      expect(yield* Effect.flip(verifyArtifact(root))).toMatchObject({ _tag: 'ArtifactInvalid', reason: 'schema' });
    }),
  );

  it.effect('a bundle whose files are the ones it names verifies, and answers the identity its contents produce', () =>
    Effect.gen(function* () {
      const manifest = yield* verifyArtifact(copy(yield* Pinned));
      expect(identityOf(manifest)).toBe(manifest.identity.digest);
    }),
  );

  it.effect('a byte changed in any part refuses, naming that part and both digests', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      writeFileSync(join(root, 'chunk.js'), text.encode('export const helper = 2;\n'), { mode: 0o600 });

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactInvalid');
      if (found._tag !== 'ArtifactInvalid' || found.reason !== 'mismatch') return;
      expect(found.path).toBe('chunk.js');
      expect(found.expected).not.toBe(found.found);
      expect(found.found).toBe(digestOf(text.encode('export const helper = 2;\n')));
    }),
  );

  it.effect('a part whose file grew refuses on its measured length, before its bytes are read', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      writeFileSync(join(root, 'recovery.js'), text.encode('x'.repeat(4096)), { mode: 0o600 });

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactInvalid');
      if (found._tag !== 'ArtifactInvalid' || found.reason !== 'mismatch') return;
      expect(found.path).toBe('recovery.js');
      expect(found.found).toBe('4096 bytes');
    }),
  );

  it.effect('a file standing in a verified bundle that no part names refuses', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      mkdirSync(join(root, 'drizzle', '0004_added_later'), { recursive: true });
      writeFileSync(join(root, 'drizzle', '0004_added_later', 'migration.sql'), text.encode('DROP TABLE runs;\n'), {
        mode: 0o600,
      });

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactInvalid');
      if (found._tag !== 'ArtifactInvalid') return;
      expect(found.reason).toBe('schema');
      expect(found.detail).toContain('drizzle/0004_added_later/migration.sql');
    }),
  );

  it.effect('a part that resolves outside the bundle refuses, wherever it points', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const outside = open();
      const target = join(outside, 'elsewhere.js');
      writeFileSync(target, text.encode('export const read = () => undefined;\n'), { mode: 0o600 });
      rmSync(join(root, 'recovery.js'));
      symlinkSync(target, join(root, 'recovery.js'));

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactUnreadable');
      if (found._tag !== 'ArtifactUnreadable') return;
      expect(found.path).toBe('recovery.js');
      expect(found.detail).toContain('outside the bundle');
    }),
  );

  it.effect('a closure missing one of its roles is not a host, and says which role', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const parts: ReadonlyArray<ArtifactPart> = [
        wrote(root, 'runtime', 'bun', '#!/bin/sh\nexit 0\n'),
        wrote(root, 'holder', 'execution-holder', '#!/bin/sh\nexit 0\n'),
        wrote(root, 'host', 'host.js', 'export const serve = () => undefined;\n'),
        wrote(root, 'platform', 'libexecution_platform.dylib', 'not really a library, but really these bytes\n'),
        wrote(root, 'carrier', 'sqlite-process.js', 'export const carrier = true;\n'),
        wrote(root, 'evidence', 'worker.js', 'export const evidence = true;\n'),
        wrote(root, 'sampler', 'usageSampler.js', 'export const sampler = true;\n'),
      ];
      const declared = {
        protocol: 'executions/1' as const,
        platform: { os: 'darwin', arch: 'arm64' },
        endpoint: { transport: 'unix', path: 'host.sock' },
        wire: { min: 1, max: 1 },
        parts,
      };
      writeFileSync(
        join(root, ARTIFACT_FILE),
        encodeManifest({ identity: { digest: identityOf(declared), build: 'fixture' }, ...declared }),
        { mode: 0o600 },
      );

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactInvalid');
      if (found._tag !== 'ArtifactInvalid') return;
      expect(found.detail).toContain('recovery');
    }),
  );

  it.effect('a role that names two launch programs is refused rather than choosing by part order', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const found = yield* readArtifact(root);
      const parts = found.parts.map((part) => (part.path === 'chunk.js' ? { ...part, role: 'host' as const } : part));
      const declared = { ...found, parts };
      writeFileSync(
        join(root, ARTIFACT_FILE),
        encodeManifest({
          ...declared,
          identity: { ...declared.identity, digest: identityOf(declared) },
        }),
      );
      const refused = yield* Effect.flip(readArtifact(root));
      expect(refused).toMatchObject({ _tag: 'ArtifactInvalid', reason: 'schema' });
    }),
  );

  it.effect('a bundle that names itself is refused before a single file is opened', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const manifest = yield* readArtifact(root);
      const borrowed = digestOf(text.encode('another bundle entirely'));
      writeFileSync(join(root, ARTIFACT_FILE), encodeManifest({ ...manifest, identity: { digest: borrowed, build: 'borrowed' } }), {
        mode: 0o600,
      });

      const found = yield* Effect.flip(verifyArtifact(root));

      expect(found._tag).toBe('ArtifactInvalid');
      if (found._tag !== 'ArtifactInvalid') return;
      expect(found.detail).toContain('its contents produce');
    }),
  );

  it.effect('command capabilities round-trip inside the artifact identity', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const found = yield* readArtifact(root);
      const commands = [{ transport: 'pipes' as const, relations: ['leader', 'work'] as const }];
      const declared = { ...found, commands };
      const manifest = { ...declared, identity: { ...declared.identity, digest: identityOf(declared) } };
      const entry = holderEntryOf(manifest);
      expect(entry).toBeDefined();
      writeFileSync(join(root, HOLDER_ENTRY_FILE), entry!);
      writeFileSync(join(root, ARTIFACT_FILE), JSON.stringify(manifest));
      const verified = yield* verifyArtifact(root);
      expect(verified.commands).toEqual(commands);
    }),
  );

  it.effect('changing command coverage without a new identity refuses the artifact', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const found = yield* readArtifact(root);
      const declared = {
        ...found,
        commands: [{ transport: 'pipes' as const, relations: ['leader'] as const }],
      };
      writeFileSync(
        join(root, ARTIFACT_FILE),
        JSON.stringify({
          ...declared,
          identity: { ...declared.identity, digest: identityOf(declared) },
          commands: [{ ...declared.commands[0], relations: ['leader', 'ancestry'] }],
        }),
      );
      expect((yield* Effect.flip(verifyArtifact(root)))._tag).toBe('ArtifactInvalid');
    }),
  );

  it.effect('the library a host loads must be the platform part its bundle pins', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const manifest = yield* readArtifact(root);
      const outside = open();
      writeFileSync(join(outside, 'other.dylib'), text.encode('other bytes\n'), { mode: 0o600 });

      const named = yield* boundTo(root, manifest, 'platform', join(root, 'libexecution_platform.dylib'));
      const elsewhere = yield* boundTo(root, manifest, 'platform', join(outside, 'other.dylib'));

      expect(named).toBe(true);
      expect(elsewhere).toBe(false);
    }),
  );

  it.effect('a path that cannot be resolved refuses with its cause instead of answering a different bundle', () =>
    Effect.gen(function* () {
      const root = copy(yield* Pinned);
      const manifest = yield* readArtifact(root);
      const path = join(root, 'libexecution_platform.dylib');
      const unreadable = FileSystem.makeNoop({
        realPath: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: 'PermissionDenied',
              module: 'FileSystem',
              method: 'realPath',
              description: 'the directory is unreadable',
            }),
          ),
      });
      const outcome = yield* Effect.result(
        boundTo(root, manifest, 'platform', path).pipe(Effect.provideService(FileSystem.FileSystem, unreadable)),
      );
      expect(outcome).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ArtifactUnreadable', root, path } });
    }),
  );
});
