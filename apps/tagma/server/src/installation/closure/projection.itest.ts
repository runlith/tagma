import { expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { Context, Effect, FileSystem, Layer, Tracer } from 'effect';
import { makeCurrentProjection } from './current.js';
import { makeManifestProjection } from './manifests.js';
import { REQUIRED_ROLES } from '../contract/wire/manifest.js';
import { Succession } from '../contract/service/succession.js';
import { successionLayer } from '../process/succession.js';
import { writeInstallation } from './write.js';
import { openVersion, swapCurrent } from '../../platform/lock/versionedDirectories.js';

it.live('current reuses identity proof for an unchanged version and detects link switches and same-size manifest replacements', () =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'installation-projection-'))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    const install = join(home, 'install');
    const parts = REQUIRED_ROLES.map((role) => ({
      role,
      path: role,
      kind: 'file' as const,
      bytes: role.length,
      digest: digestOf(new TextEncoder().encode(role)),
    }));
    for (const version of ['first', 'other']) {
      yield* writeInstallation(openVersion(install, version), { os: 'darwin', arch: 'arm64' }, version, parts).pipe(
        Effect.provide(BunFileSystem.layer),
      );
    }
    swapCurrent(install, 'first');
    const succession = Context.get(yield* Layer.build(successionLayer(undefined, install, join(home, 'serve.log'), () => {})), Succession);
    let proofs = 0;
    const tracer = Tracer.make({
      ...Tracer.nativeTracer,
      span: (options) => {
        if (options.name === 'installation.read') proofs += 1;
        return Tracer.nativeTracer.span(options);
      },
    });
    const read = succession.current.pipe(Effect.withTracer(tracer));
    const simultaneous = yield* Effect.all([read, read], { concurrency: 'unbounded' });
    expect(simultaneous.map((installation) => installation?.manifest.identity.build)).toEqual(['first', 'first']);
    expect(proofs).toBe(1);
    swapCurrent(install, 'other');
    expect((yield* read)?.manifest.identity.build).toBe('other');
    expect(proofs).toBe(2);
    swapCurrent(install, 'first');
    expect((yield* read)?.manifest.identity.build).toBe('first');
    expect(proofs).toBe(2);
    const path = join(install, 'first', 'install.json');
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.replace('"first"', '"third"'));
    utimesSync(path, 1, 1);
    expect((yield* read)?.manifest.identity.build).toBe('third');
    expect(proofs).toBe(3);
    writeFileSync(path, readFileSync(path, 'utf8').replace('"path": "surface"', '"path": "surfacE"'));
    utimesSync(path, 1, 1);
    expect(yield* Effect.flip(read)).toMatchObject({ _tag: 'InstallationInvalid', reason: 'malformed' });
    rmSync(path);
    expect(yield* read).toBeNull();
    writeFileSync(path, text);
    expect((yield* read)?.manifest.identity.build).toBe('first');
    const files = yield* FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer));
    const switched = FileSystem.makeNoop({
      ...files,
      readFileString: (path, options) =>
        files.readFileString(path, options).pipe(Effect.tap(() => Effect.sync(() => swapCurrent(install, 'other')))),
    });
    const moving = yield* makeCurrentProjection.pipe(Effect.provideService(FileSystem.FileSystem, switched));
    expect((yield* moving.read(join(install, 'current'))).identity.build).toBe('other');
    const vanished = FileSystem.makeNoop({
      ...files,
      readFileString: (path, options) =>
        files.readFileString(path, options).pipe(Effect.tap(() => Effect.sync(() => rmSync(join(install, 'other', 'install.json'))))),
    });
    const removed = yield* makeCurrentProjection.pipe(Effect.provideService(FileSystem.FileSystem, vanished));
    expect(yield* Effect.flip(removed.read(join(install, 'current')))).toMatchObject({
      _tag: 'InstallationMissing',
      root: join(install, 'current'),
    });
  }),
);

it.live('server and window projections release a pruned cold version while retaining the current and immediately previous versions', () =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'installation-retention-'))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    );
    const install = join(home, 'install');
    const parts = REQUIRED_ROLES.map((role) => ({
      role,
      path: role,
      kind: 'file' as const,
      bytes: role.length,
      digest: digestOf(new TextEncoder().encode(role)),
    }));
    for (const version of ['first', 'other', 'third']) {
      yield* writeInstallation(openVersion(install, version), { os: 'darwin', arch: 'arm64' }, version, parts).pipe(
        Effect.provide(BunFileSystem.layer),
      );
    }
    const server = Context.get(yield* Layer.build(successionLayer(undefined, install, join(home, 'serve.log'), () => {})), Succession);
    const window = makeManifestProjection();
    const weak = Effect.all([
      server.current.pipe(Effect.map((installation) => new WeakRef(installation!.manifest))),
      Effect.sync(() => {
        const reading = window.read(join(install, 'current'));
        expect(reading._tag).toBe('Read');
        if (reading._tag !== 'Read') throw new Error('the fixture is not an installation');
        return new WeakRef(reading.manifest);
      }),
    ]);
    swapCurrent(install, 'first');
    const first = yield* weak;
    swapCurrent(install, 'other');
    const other = yield* weak;
    swapCurrent(install, 'first');
    const returned = yield* weak;
    for (let index = 0; index < first.length; index += 1) expect(returned[index]!.deref()).toBe(first[index]!.deref());
    rmSync(join(install, 'other'), { recursive: true });
    swapCurrent(install, 'third');
    const third = yield* weak;
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    Bun.gc(true);
    expect(other.map((version) => version.deref()?.identity.build)).toEqual([undefined, undefined]);
    for (const version of first) expect(version.deref()?.identity.build).toBe('first');
    const standing = yield* weak;
    for (let index = 0; index < third.length; index += 1) expect(standing[index]!.deref()).toBe(third[index]!.deref());
  }),
);
