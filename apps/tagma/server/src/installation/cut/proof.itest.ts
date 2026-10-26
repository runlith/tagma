import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { packRelease } from './pipeline.js';
import { archiveTrouble, developerInputs, sourceComments } from './proof.js';

const scratched = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'tagma-proof-')))),
  (scratch) => Effect.sync(() => rmSync(scratch, { recursive: true, force: true })),
);

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const unwanted = {
  labels: [
    { text: 'private-adapter', by: 'the developer package' },
    { text: 'You are a fixture agent.', by: 'the developer package' },
  ],
  paths: [homedir()],
  comments: ['//! a why this source keeps for itself'],
  root: '',
};

const staged = (scratch: string, name: string, files: Readonly<Record<string, string>>): string => {
  const root = join(scratch, name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const quarantined = (path: string): void => {
  expect(Bun.spawnSync(['/usr/bin/xattr', '-w', 'com.apple.quarantine', '0081;00000000;Safari;', path]).exitCode).toBe(0);
};

const tarred = (args: readonly string[]): string => {
  const ran = Bun.spawnSync(['/usr/bin/tar', ...args], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  expect(ran.exitCode).toBe(0);
  return ran.stdout.toString();
};

const CLEAN = {
  'install.json': '{}\n',
  bun: '#!/bin/sh\n',
  'executions/bun': '#!/bin/sh\n',
  'bin/server/http.js': 'const scanner = { id: "private-adapter-token" };\nconst other = "private-adapterless";\n',
  'surface/index.html': '<p>Tagma</p>\n',
};

it.live(
  'a staged release packs into an archive the proof accepts: rooted at the release, without the bun its host bundle clones, without owner names, and without the quarantine a staged file carried',
  () =>
    Effect.gen(function* () {
      const scratch = yield* scratched;
      const root = staged(scratch, 'clean', CLEAN);
      quarantined(join(root, 'surface/index.html'));
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

it.live(
  'the proof names each entry that carries a declared label as a whole token in any case or as the whole file, its own comment or module banner, a source map, an inline map, a path under the home of the machine that built it however escaped, a link out of the release, a developer adapter or the bun its host bundle clones, and an archive wrapped in a directory',
  () =>
    Effect.gen(function* () {
      const scratch = yield* scratched;
      staged(scratch, 'clean', CLEAN);
      const root = staged(scratch, 'defects', {
        ...CLEAN,
        'bin/server/http.js': 'const provider = "private-adapter";\n',
        'bin/server/header.js': 'const header = "Private-Adapter";\n',
        'bin/server/whole.txt': 'private-adapter',
        'bin/server/kept.js': 'run();\n//! a why this source keeps for itself\n',
        'bin/server/bannered.js': 'run();\n// apps/tagma/server/src/run.ts\nrun();\n',
        'surface/app.js.map': '{"version":3}\n',
        'surface/inline.js': 'run();\n//# sourceMappingURL=data:application/json;base64,e30=\n',
        'surface/escaped.json': `{"from":"${unwanted.paths[0]!.replaceAll('/', '\\/')}\\/work"}`,
        'tools/engine': `\u0000\u0001${unwanted.paths[0]}/.cargo/registry/src/lib.rs\u0000`,
        'adapters/masking.js': 'export {};\n',
        'desktop/app/main.mjs': 'const prompt = `You are a fixture agent.`;\n',
        'desktop/app/plain.txt': 'nothing to see\n',
        'node_modules/dep/bannered.js': 'run();\n// src/dep.ts\nrun();\n',
      });
      symlinkSync('../../outside', join(root, 'desktop/out'));
      symlinkSync('../app/plain.txt', join(root, 'desktop/inside'));
      writeFileSync(join(root, 'bin/Private-Adapter.txt'), 'named\n');
      const archive = join(scratch, 'defects.tar.gz');
      tarred(['--no-xattrs', '-czf', archive, '-C', root, '.']);
      const wrapped = join(scratch, 'wrapped.tar.gz');
      tarred(['--no-xattrs', '-czf', wrapped, '-C', scratch, 'clean']);

      const trouble = yield* archiveTrouble(archive, unwanted);
      const around = yield* archiveTrouble(wrapped, unwanted);

      expect(new Set(trouble.map((one) => one.split(' ')[0]))).toEqual(
        new Set([
          'bin/server/http.js',
          'bin/server/header.js',
          'bin/server/whole.txt',
          'bin/server/kept.js',
          'bin/server/bannered.js',
          'surface/app.js.map',
          'surface/inline.js',
          'surface/escaped.json',
          'tools/engine',
          'adapters',
          'adapters/masking.js',
          'executions/bun',
          'desktop/app/main.mjs',
          './desktop/out',
          'the',
        ]),
      );
      expect(trouble.filter((one) => one.startsWith('the '))).toEqual([
        'the entry name bin/Private-Adapter.txt carries the label "private-adapter" that the developer package declares',
      ]);
      expect(around).toHaveLength(1);
      expect(around[0]).toContain('install.json');
    }),
);

it.live(
  'the comments a release proof seeks are the kept comments of its own sources, never a string that looks like one or a dependency`s note',
  () =>
    Effect.gen(function* () {
      const own = staged(yield* scratched, 'commented', {
        'src/a.ts': 'export const s = `\n//! a string line\n`;\n//! why a stands\nexport const b = 1;\n',
        'node_modules/dep/index.js': '/*! dep is licensed */\nexport const n = 1;\n',
      });

      const comments = yield* sourceComments([join(own, 'src/a.ts'), join(own, 'node_modules/dep/index.js')], own);

      expect(comments).toEqual(['//! why a stands']);
    }),
);

it.live('an archive packed with extended attributes is refused for each entry that carries one, naming the quarantine', () =>
  Effect.gen(function* () {
    const scratch = yield* scratched;
    const root = staged(scratch, 'attributed', CLEAN);
    quarantined(join(root, 'surface/index.html'));
    const archive = join(scratch, 'attributed.tar.gz');
    tarred(['-czf', archive, '-C', root, '.']);

    const trouble = yield* archiveTrouble(archive, unwanted);

    expect(trouble.find((one) => one.startsWith('surface/index.html '))).toContain('com.apple.quarantine');
  }),
);

it.live(
  'the composition proof finds the sources of developer packages and server modules among a build`s inputs, whatever query a bundler hung on them',
  () =>
    Effect.gen(function* () {
      const root = staged(yield* scratched, 'inputs', {
        'packages/adapter/package.json': JSON.stringify({ name: '@fixture/adapter', tagma: { build: 'developer' } }),
        'packages/adapter/src/entry.ts': 'export {};\n',
        'server/diagnostics/module.json': JSON.stringify({ tagma: { build: 'developer' } }),
        'server/diagnostics/entry.ts': 'export {};\n',
        'packages/public/package.json': JSON.stringify({ name: '@fixture/public' }),
        'packages/public/src/entry.ts': 'export {};\n',
      });
      const adapter = join(root, 'packages/adapter/src/entry.ts');
      const diagnostics = join(root, 'server/diagnostics/entry.ts');

      const found = yield* developerInputs([
        `${adapter}?inline`,
        diagnostics,
        join(root, 'packages/public/src/entry.ts'),
        '\u0000virtual:entry',
      ]);

      expect(found.map((one) => [relative(root, one.input), relative(root, one.manifest)])).toEqual([
        ['packages/adapter/src/entry.ts', 'packages/adapter/package.json'],
        ['server/diagnostics/entry.ts', 'server/diagnostics/module.json'],
      ]);
    }),
);
