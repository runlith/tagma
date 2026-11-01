import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { Git, gitLayer } from './Git.js';
import { run } from './repository.js';
import { visibleAmong } from './entries.js';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const fixture = gitLayer.pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(platform))), Layer.provideMerge(platform));

it.live('visible paths keep the requested Unicode spelling and scoped coverage beyond one command line', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'git-visible-' });
    yield* run(git, root, ['init', '-q'], undefined);
    yield* run(git, root, ['config', 'core.precomposeUnicode', 'true'], undefined);
    const nfd = 'cafe\u0301.txt';
    const nfc = nfd.normalize('NFC');
    yield* files.writeFileString(join(root, nfd), 'visible\n');
    yield* files.writeFileString(join(root, '.gitignore'), 'hidden.txt\n');
    yield* files.writeFileString(join(root, 'hidden.txt'), 'ignored\n');
    yield* files.writeFileString(join(root, 'elsewhere.txt'), 'outside the request\n');
    const equivalent = yield* files.exists(join(root, nfc));
    const long = Array.from({ length: 4 }, (_, at) => `absent/${'segment/'.repeat(600)}${at}`);
    const seen = yield* visibleAmong(git, root, [...long, nfd, nfc, 'hidden.txt', 'missing.txt']);
    expect([...seen]).toEqual(equivalent ? [nfd, nfc] : [nfd]);

    if (!equivalent) {
      yield* files.writeFileString(join(root, nfc), 'a distinct name\n');
      yield* files.writeFileString(join(root, '.gitignore'), `hidden.txt\n${nfc}\n`);
      expect([...(yield* visibleAmong(git, root, [nfd, nfc]))]).toEqual([nfd]);
    }
  }).pipe(Effect.provide(fixture)),
);
