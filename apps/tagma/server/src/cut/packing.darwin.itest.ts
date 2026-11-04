import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { packRelease } from './pipeline.js';
import { archiveTrouble } from './proof.js';

const scratched = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-packing-')))),
  (scratch) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const unwanted = { labels: [], paths: [homedir()], comments: [], root: '' };
const staged = (scratch: string): string => {
  const root = join(scratch, 'release');
  for (const [path, text] of Object.entries({
    'install.json': '{}\n',
    bun: '#!/bin/sh\n',
    'executions/bun': '#!/bin/sh\n',
    'bin/server/http.js': 'export {};\n',
    'surface/index.html': '<p>Tagma</p>\n',
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  expect(
    Bun.spawnSync(['/usr/bin/xattr', '-w', 'com.apple.quarantine', '0081;00000000;Safari;', join(root, 'surface/index.html')]).exitCode,
  ).toBe(0);
  return root;
};
const tarred = (args: readonly string[]): string => {
  const ran = Bun.spawnSync(['/usr/bin/tar', ...args], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  expect(ran.exitCode).toBe(0);
  return ran.stdout.toString();
};

it.live(
  'a staged release packs into an archive the proof accepts: rooted at the release, without the bun its host bundle clones, without owner names, and without the quarantine a staged file carried',
  () =>
    Effect.gen(function* () {
      const scratch = yield* scratched;
      const root = staged(scratch);
      const archive = join(scratch, 'clean.tar.gz');
      yield* packRelease(root, archive).pipe(Effect.provide(spawning));
      const listing = tarred(['-tvzf', archive]);
      expect(
        new Set(
          tarred(['-tzf', archive])
            .split('\n')
            .filter((line) => line !== ''),
        ),
      ).toEqual(
        new Set([
          './',
          './bin/',
          './bin/server/',
          './bin/server/http.js',
          './bun',
          './executions/',
          './install.json',
          './surface/',
          './surface/index.html',
        ]),
      );
      expect(listing).not.toContain(userInfo().username);
      expect(yield* archiveTrouble(archive, unwanted)).toEqual([]);
    }),
);

it.live('an archive packed with extended attributes is refused for each entry that carries one, naming the quarantine', () =>
  Effect.gen(function* () {
    const scratch = yield* scratched;
    const root = staged(scratch);
    const archive = join(scratch, 'attributed.tar.gz');
    tarred(['-czf', archive, '-C', root, '.']);
    const trouble = yield* archiveTrouble(archive, unwanted);
    expect(trouble.find((one) => one.startsWith('surface/index.html '))).toContain('com.apple.quarantine');
  }),
);
