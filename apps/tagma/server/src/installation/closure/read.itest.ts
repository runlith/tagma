import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { CLI_ENTRY, INSTALL_FILE, RUNTIME_PART, SERVE_FLAGS } from '../contract/wire/layout.js';
import { type InstallationPart, type InstallationRole, PACKAGE_FILE, SERVER_ENTRY } from '../contract/wire/manifest.js';
import { serverPartsStand } from './present.js';
import { partsAt, readInstallation, verifyInstallation } from './read.js';
import { writeInstallation } from './write.js';
import { writeLauncher } from '../setup/launcher.js';

const tree = mkdtempSync('/tmp/install-closure-');
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const run = <A, E>(work: Effect.Effect<A, E, FileSystem.FileSystem>) => work.pipe(Effect.provide(BunFileSystem.layer));

const platform = { os: 'darwin', arch: 'arm64' } as const;

const wrote = (root: string, relative: string, text: string, mode = 0o600): void => {
  mkdirSync(dirname(join(root, relative)), { recursive: true });
  writeFileSync(join(root, relative), text, { mode });
};

const LAYOUT: ReadonlyArray<readonly [InstallationRole, string]> = [
  ['runtime', RUNTIME_PART],
  ['cli', CLI_ENTRY],
  ['server', SERVER_ENTRY],
  ['server', PACKAGE_FILE],
  ['migrations', 'drizzle'],
  ['surface', 'surface'],
  ['executions', 'executions'],
];

const closure = (name: string): string => {
  const root = join(tree, name);
  mkdirSync(root, { recursive: true });
  wrote(root, RUNTIME_PART, '#!/bin/sh\nexit 0\n', 0o700);
  wrote(root, CLI_ENTRY, 'console.log("cli");\n');
  wrote(root, SERVER_ENTRY, 'console.log("server");\n');
  wrote(root, PACKAGE_FILE, '{"name":"@tagma/server","version":"0.1.0"}\n');
  wrote(root, 'drizzle/0001_first/migration.sql', 'select 1;\n');
  wrote(root, 'surface/index.html', '<html>the surface</html>\n');
  wrote(root, 'executions/artifact.json', '{"version":1}\n');
  wrote(root, 'desktop/Tagma.app/Contents/MacOS/Tagma', 'the application binary\n', 0o700);
  wrote(root, 'surface/One.framework/Versions/A/One', 'a framework\n');
  symlinkSync('A', join(root, 'surface/One.framework/Versions/Current'));
  return root;
};

const measured = (root: string, layout = LAYOUT) =>
  run(Effect.forEach(layout, ([role, relative]) => partsAt(root, role, relative)).pipe(Effect.map((found) => found.flat())));

const stand = Effect.fnUntraced(function* (name: string, layout = LAYOUT) {
  const root = closure(name);
  yield* run(writeInstallation(root, platform, 'abc1234', yield* measured(root, layout)));
  return root;
});

const refusalOf = (root: string) =>
  Effect.map(Effect.flip(run(verifyInstallation(root))), (refusal): Record<string, unknown> => ({ ...refusal }));

describe('an installation closure', () => {
  it.live('a written closure verifies beside the application it keeps, and the identity it answers is the one its contents produce', () =>
    Effect.gen(function* () {
      const root = yield* stand('good');
      const manifest = yield* run(verifyInstallation(root));
      expect(manifest.identity.build).toBe('abc1234');
      expect(manifest.platform).toEqual(platform);
      expect([...new Set(manifest.parts.map((part) => part.role))].sort()).toEqual([
        'cli',
        'executions',
        'migrations',
        'runtime',
        'server',
        'surface',
      ]);
      expect(manifest.parts.filter((part) => part.kind === 'link').map((part) => part.path)).toEqual([
        'surface/One.framework/Versions/Current',
      ]);
      expect(manifest.parts.some((part) => part.path === INSTALL_FILE)).toBe(false);
    }),
  );

  it.live('one byte of the surface changed refuses by role and by path', () =>
    Effect.gen(function* () {
      const root = yield* stand('byte');
      writeFileSync(join(root, 'surface/index.html'), '<html>the surfacE</html>\n');
      expect(yield* refusalOf(root)).toMatchObject({
        _tag: 'InstallationInvalid',
        reason: 'mismatch',
        role: 'surface',
        path: 'surface/index.html',
      });
    }),
  );

  it.live('a version link pointed somewhere else refuses, though every file still hashes', () =>
    Effect.gen(function* () {
      const root = yield* stand('link');
      const link = join(root, 'surface/One.framework/Versions/Current');
      mkdirSync(join(root, 'surface/One.framework/Versions/B'), { recursive: true });
      rmSync(link);
      symlinkSync('B', link);
      expect(yield* refusalOf(root)).toMatchObject({ _tag: 'InstallationInvalid', reason: 'mismatch', role: 'surface' });
    }),
  );

  it.live('a file standing in the closure that no part names refuses', () =>
    Effect.gen(function* () {
      const root = yield* stand('extra');
      wrote(root, 'drizzle/0002_later/migration.sql', 'drop table blocks;\n');
      const refusal = yield* refusalOf(root);
      expect(refusal).toMatchObject({ _tag: 'InstallationInvalid', reason: 'malformed' });
      expect(String(refusal.detail)).toContain('drizzle/0002_later/migration.sql');
    }),
  );

  it.live('a server file the manifest names and the closure lacks refuses a start by its path, and a whole closure passes', () =>
    Effect.gen(function* () {
      const root = yield* stand('absent');
      const manifest = yield* run(readInstallation(root));
      yield* run(serverPartsStand({ root, manifest }));
      rmSync(join(root, SERVER_ENTRY));
      expect(yield* Effect.flip(run(serverPartsStand({ root, manifest })))).toMatchObject({
        _tag: 'InstallationUnreadable',
        role: 'server',
        path: SERVER_ENTRY,
      });
    }),
  );

  it.live('a declared server link whose module is missing refuses a start by the linked path', () =>
    Effect.gen(function* () {
      const root = closure('dangling-server');
      rmSync(join(root, SERVER_ENTRY));
      symlinkSync('missing.js', join(root, SERVER_ENTRY));
      const manifest = yield* run(writeInstallation(root, platform, 'linked', yield* measured(root)));
      expect(yield* Effect.flip(run(serverPartsStand({ root, manifest })))).toMatchObject({
        _tag: 'InstallationUnreadable',
        role: 'server',
        path: SERVER_ENTRY,
      });
    }),
  );

  it.live('a manifest carrying no surface is not a closure, and it refuses before a file is opened', () =>
    Effect.gen(function* () {
      const root = yield* stand(
        'roleless',
        LAYOUT.filter(([role]) => role !== 'surface'),
      );
      rmSync(join(root, 'surface'), { recursive: true, force: true });
      const refused = yield* Effect.flip(run(readInstallation(root)));
      expect(String((refused as { detail: string }).detail)).toContain('surface');
    }),
  );

  it.live('a directory with no manifest is not an installation, and says so as its own answer', () =>
    Effect.gen(function* () {
      const root = join(tree, 'bare');
      mkdirSync(root, { recursive: true });
      const refused = yield* Effect.flip(run(readInstallation(root)));
      expect(refused._tag).toBe('InstallationMissing');
    }),
  );
});

describe('the launcher', () => {
  const place = (name: string) => {
    const home = join(tree, name);
    return {
      root: join(home, 'install'),
      path: join(home, 'bin', 'tagma'),
      shell: { HOME: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' },
    };
  };
  const installed = (root: string): void => {
    const version = join(root, '20260101T000000000Z');
    wrote(version, RUNTIME_PART, '#!/bin/sh\necho "ran $*"\n', 0o700);
    wrote(version, CLI_ENTRY, 'console.log("never read by the fake runtime");\n');
    symlinkSync('20260101T000000000Z', join(root, 'current'));
  };

  it.live('with nothing installed it refuses and names where nothing stands', () =>
    Effect.gen(function* () {
      const { root, path, shell } = place('empty-launcher');
      mkdirSync(root, { recursive: true });
      const written = yield* run(writeLauncher(root, path, platform, shell));
      expect(written.path).toBe(path);
      const said = yield* spawnedEffect([path, 'status'], { stdout: 'pipe', stderr: 'pipe' });
      expect(said.exitCode).toBe(1);
      expect(said.stderr.toString()).toContain(`nothing is installed at ${root}/current`);
    }),
  );

  it.live('with a closure standing it execs that closure’s runtime on its CLI, arguments and all', () =>
    Effect.gen(function* () {
      const { root, path, shell } = place('installed-launcher');
      installed(root);
      yield* run(writeLauncher(root, path, platform, shell));
      const said = yield* spawnedEffect([path, 'status', '--json'], { stdout: 'pipe', stderr: 'pipe' });
      expect(said.exitCode).toBe(0);
      expect(said.stdout.toString().trim()).toBe(`ran ${SERVE_FLAGS.join(' ')} ${join(root, 'current', CLI_ENTRY)} status --json`);
    }),
  );

  it.live('on another machine it refuses rather than running a closure cut elsewhere', () =>
    Effect.gen(function* () {
      const { root, path: elsewhere, shell } = place('foreign-launcher');
      installed(root);
      yield* run(writeLauncher(root, elsewhere, { os: 'linux', arch: 'x64' }, shell));
      chmodSync(elsewhere, 0o700);
      const said = yield* spawnedEffect([elsewhere], { stdout: 'pipe', stderr: 'pipe' });
      expect(said.exitCode).toBe(1);
      expect(said.stderr.toString()).toContain('linux/x64');
    }),
  );
});
