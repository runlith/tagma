import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as Memory from '@runlith/testbed/memory';
import { digestOf } from '@runlith/executions/hostArtifacts';
import { Effect, FileSystem } from 'effect';
import { REQUIRED_ROLES } from '../contract/wire/manifest.js';
import { verifyInstallation } from './read.js';
import { writeInstallation } from './write.js';

it.effect('verification streams the parts of an installation on a filesystem that cannot materialize them whole', () =>
  Effect.gen(function* () {
    const files = yield* Memory.make;
    const root = '/release';
    yield* files.makeDirectory(root);
    const bytes = new TextEncoder().encode('the installed bytes');
    const runtime = new Uint8Array(64 * 1024 + 1).fill(1);
    const parts = REQUIRED_ROLES.map((role) => {
      const contents = role === 'runtime' ? runtime : bytes;
      return { role, path: role, kind: 'file' as const, bytes: contents.length, digest: digestOf(contents) };
    });
    for (const part of parts) yield* files.writeFile(`${root}/${part.path}`, part.role === 'runtime' ? runtime : bytes);
    const manifest = yield* writeInstallation(root, { os: 'darwin', arch: 'arm64' }, 'first', parts).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
    );
    const streamed = FileSystem.makeNoop({
      ...files,
      readFile: () => Effect.die('part bytes must fit a streaming read, not a whole-file allocation'),
    });
    expect(yield* verifyInstallation(root).pipe(Effect.provideService(FileSystem.FileSystem, streamed))).toEqual(manifest);
    yield* files.writeFile(`${root}/surface`, new TextEncoder().encode('the Installed bytes'));
    expect(yield* Effect.flip(verifyInstallation(root).pipe(Effect.provideService(FileSystem.FileSystem, streamed)))).toMatchObject({
      _tag: 'InstallationInvalid',
      reason: 'mismatch',
      role: 'surface',
      path: 'surface',
      expected: digestOf(bytes),
      found: digestOf(new TextEncoder().encode('the Installed bytes')),
    });
  }),
);
