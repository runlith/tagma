import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { storageHomes } from '../../graph/storage/layout.js';
import { databasePath, installationAnchor, installationRoot, launcherPath } from '../paths.js';
import { dataDirectory, installationsRoot, serveLogPath } from '../contract/wire/layout.js';
import { portBlock } from '../contract/wire/ports.js';
import { CHANNELS } from '../contract/wire/channel.js';
import type { HealthAnswer } from './port.js';
import { answeredHere, besideConflict, besideEnv, besidePort, besideRoot } from './beside.js';
import { writeLauncherBeside } from '../setup/launcher.js';
import type { InstallationPlatform } from '../contract/wire/manifest.js';

const channel = CHANNELS.dev;
const BESIDE_PORT = besidePort(channel);

const tree = realpathSync(mkdtempSync('/tmp/tagma-beside-'));
afterAll(() => rmSync(tree, { recursive: true, force: true }));

const held = Object.keys(besideEnv(tree, BESIDE_PORT));

const speaking = <A>(root: string, read: () => A): A => {
  const stood = held.map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, besideEnv(root, 5634));
  try {
    return read();
  } finally {
    for (const [name, value] of stood) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

describe('a Tagma standing beside', () => {
  test('every path of the world stands under its own root', () => {
    const root = join(tree, 'beside');
    const world = speaking(root, () => {
      const database = databasePath(channel);
      return {
        database,
        installRoot: installationRoot(channel),
        launcher: launcherPath(channel),
        log: serveLogPath(channel, process.env),
        appHome: storageHomes(database).appHome,
        executions: installationAnchor(database),
      };
    });
    for (const [name, path] of Object.entries(world)) {
      expect(`${name}: ${path}`).toBe(`${name}: ${path?.startsWith(root) === true ? path : `OUTSIDE ${root}`}`);
    }
  });

  test('its root is neither the working data directory nor the root of its closures', () => {
    const shell = { HOME: '/Users/someone' };
    const root = besideRoot(channel, '/Users/someone');
    expect(root).not.toBe(dataDirectory(channel, shell));
    expect(root).not.toBe(installationsRoot(channel, shell));
    expect(besideConflict(root, shell)).toBeNull();
  });

  test('a root that is, holds or lies inside the working world is named as the collision it is', () => {
    const shell = { HOME: '/Users/someone' };
    const working = dataDirectory(channel, shell) as string;
    expect(besideConflict(working, shell)).toBe(working);
    expect(besideConflict(`${working}/install`, shell)).toBe(working);
    expect(besideConflict('/Users/someone', shell)).not.toBeNull();
    expect(besideConflict(`/Users/someone/${channel.data}-try`, shell)).toBeNull();
    for (const other of Object.values(CHANNELS)) {
      expect(besideConflict(`/Users/someone/${other.data}`, shell)).toBe(`/Users/someone/${other.data}`);
    }
  });

  test('its whole port block stands apart from the block of every channel', () => {
    const named = besideEnv('/tmp/beside', BESIDE_PORT);
    const ports = [named.TAGMA_PORT, named.TAGMA_ARTIFACT_PORT, named.TAGMA_REMOTE_PORT, named.TAGMA_SANDBOX_PORT];
    expect(ports).toEqual(Object.values(portBlock(BESIDE_PORT)).map(String));
    for (const working of Object.values(CHANNELS)) {
      for (const port of Object.values(portBlock(working.port))) expect(ports).not.toContain(String(port));
    }
  });

  it.live('a launcher cut beside leaves the profile of the shell alone', () =>
    Effect.gen(function* () {
      const home = join(tree, 'home');
      mkdirSync(home, { recursive: true });
      const profile = join(home, '.zshrc');
      writeFileSync(profile, 'export PATH="$HOME/.tagma/bin:$PATH"\n');
      const root = join(tree, 'beside-install');
      const launcher = join(tree, 'beside-bin', 'tagma');

      const written = yield* writeLauncherBeside(root, launcher, { os: 'darwin', arch: 'arm64' }).pipe(Effect.provide(BunFileSystem.layer));

      expect(written).toBe(launcher);
      expect(readFileSync(launcher, 'utf8')).toContain(root);
      expect(readFileSync(profile, 'utf8')).toBe('export PATH="$HOME/.tagma/bin:$PATH"\n');
      expect(statSync(launcher).mode & 0o777).toBe(0o700);
    }),
  );

  it.live('a launcher cut beside runs its closure under the beside world it was cut for', () =>
    Effect.gen(function* () {
      const root = join(tree, 'beside-run');
      const env = besideEnv(root, 5634);
      const installRoot = env.TAGMA_INSTALL_ROOT as string;
      const current = join(installRoot, 'current');
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, 'bun'), '#!/bin/sh\nenv | grep ^TAGMA_\n', { mode: 0o700 });
      const launcher = join(root, 'bin', 'tagma');
      const platform: InstallationPlatform = {
        os: process.platform === 'darwin' ? 'darwin' : 'linux',
        arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      };

      yield* writeLauncherBeside(installRoot, launcher, platform, env).pipe(Effect.provide(BunFileSystem.layer));

      const out = execFileSync(launcher, [], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
      for (const [name, value] of Object.entries(env)) expect(out).toContain(`${name}=${value}`);
    }),
  );

  describe('whose server answers', () => {
    const health = (database: string): HealthAnswer => ({
      _tag: 'Health',
      health: { database } as unknown as Extract<HealthAnswer, { _tag: 'Health' }>['health'],
    });

    test('an answer naming this database is this one', () => {
      expect(answeredHere(health('/root/data/tagma.sqlite'), '/root/data/tagma.sqlite')).toBe(true);
    });

    test('an answer on another database is never this one, however right the port looked', () => {
      expect(answeredHere(health('/Users/me/.tagma/tagma.sqlite'), '/root/data/tagma.sqlite')).toBe(false);
    });

    test('silence is not this one', () => {
      expect(answeredHere(null, '/root/data/tagma.sqlite')).toBe(false);
    });
  });
});
