import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { type GitHubCli, ProgramFailed } from '@runlith/github/GitHubCli';
import type { Applications } from '../contract/service/applications.js';
import { CHANNELS } from '../contract/wire/channel.js';
import type { Feed } from '../contract/wire/feed.js';
import { cutRelease } from './pipeline.js';

const REPO = 'test/tagma';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tagma-cut-judged-')));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

const git = (cwd: string, args: readonly string[]) =>
  expect(Bun.spawnSync(['git', '-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).exitCode).toBe(0);

const migration = (folder: string, name: string): void => {
  mkdirSync(join(folder, name), { recursive: true });
  writeFileSync(join(folder, name, 'migration.sql'), 'select 1;\n');
};

const unplaced = () => Promise.reject(new Error('a refused cut places no application'));
const applications: Applications = {
  carrier: () => null,
  carried: () => null,
  verify: unplaced,
  copy: unplaced,
  unquarantine: unplaced,
  forget: () => undefined,
  signature: unplaced,
};

const published: Feed = {
  releases: [
    {
      release: '0.2.0',
      platforms: {
        'darwin-arm64': { archive: `https://github.com/${REPO}/releases/download/v0.2.0/a.tar.gz`, sha256: '0'.repeat(64), size: 1 },
      },
      irreversible: false,
      stores: {
        'machine-store': ['20261010115509_baseline', '20261020000000_published'],
        'host-store': ['20260908052548_gateway'],
        graph: [],
        journal: [],
      },
      changes: [],
    },
  ],
};

const gh: GitHubCli = {
  run: (args) =>
    Effect.suspend(() => {
      const answer = (stdout: string) => Effect.succeed({ status: 0 as const, stdout, stderr: '' });
      if (args[0] === 'api') return answer('v0.2.0\nv0.2.1\n');
      if (args[1] === 'view') return answer(JSON.stringify({ tagName: 'v0.2.0', assets: [{ name: 'feed.json' }] }));
      if (args[1] === 'download' && args[2] === 'v0.2.0') {
        writeFileSync(join(args[args.indexOf('--dir') + 1]!, 'feed.json'), JSON.stringify(published));
        return answer('');
      }
      return Effect.fail(new ProgramFailed({ phase: 'exit', detail: `gh ${args.join(' ')} is not faked`, status: 1 }));
    }),
};

it.live(
  'a cut is refused before it builds when it names a number not above every published one, a taken-down prerelease included, or lacks a migration the newest published release carried',
  () =>
    Effect.gen(function* () {
      const checkout = join(scratch, 'checkout');
      const source = join(checkout, 'apps/tagma/server');
      migration(join(source, 'drizzle'), '20261010115509_baseline');
      migration(join(source, 'drizzle'), '20261021000000_newer');
      migration(join(checkout, 'packages/execution-host/drizzle'), '20260908052548_gateway');
      git(checkout, ['init', '-q', '-b', 'main']);
      git(checkout, ['add', '-A']);
      git(checkout, ['commit', '-q', '-m', 'cut']);
      const cut = (asked: string | null) =>
        Effect.flip(
          cutRelease(source, {
            composition: {
              conditions: [],
              channel: CHANNELS.stable,
              applications,
              entries: { cli: 'composition/release/cli.ts', server: 'composition/release/server.ts' },
            },
            asked,
            out: join(scratch, 'release'),
            cache: { runtimes: join(scratch, 'runtimes'), packages: join(scratch, 'packages') },
            steps: { graph: [], journal: [] },
            repo: REPO,
            gh,
          }),
        ).pipe(Effect.provide(machine));

      const behind = yield* cut('0.2.1');
      const lacking = yield* cut(null);

      expect(behind.step).toBe('version');
      expect(lacking.step).toBe('stores');
      expect(lacking.detail).toContain('machine-store 20261020000000_published');
    }),
);
