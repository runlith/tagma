import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import type { Assembled } from '@tagma/inspection/builtins';
import { Effect, FileSystem } from 'effect';
import { dirname, join } from 'node:path';
import { inspections } from './inspectionLanes.js';

const inspection: Assembled = {
  builtin: 'platforms',
  params: {
    base: '',
    platforms: { node: { runtime: 'node', unmarked: true }, bun: { runtime: 'bun', unmarked: true } },
    shipped: 'bun',
    allows: {},
    refuses: { bun: ['node:fs'] },
    packages: { a: { loads: { bun: ['heavy'] } } },
    apps: [],
    compiled: [],
    leaves: [],
    files: { extensions: ['.ts'], exclude: [] },
  },
};

it.live('a sliced judgement governs its reach and still follows a changed foreign dependency', () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'platform-reach-' });
    const cacheRoot = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'platform-reach-cache-' });
    const service = yield* Effect.acquireRelease(
      Effect.sync(() => inspections({ cacheRoot })),
      (held) => Effect.sync(() => held.close()),
    );
    const git = (...args: string[]) => Effect.promise(() => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet());
    const write = Effect.fnUntraced(function* (files: Record<string, string>) {
      for (const [path, text] of Object.entries(files)) {
        yield* fileSystem.makeDirectory(dirname(join(root, path)), { recursive: true });
        yield* fileSystem.writeFileString(join(root, path), text);
      }
    });
    const commit = Effect.fnUntraced(function* () {
      yield* git('add', '-A');
      yield* git('commit', '-qm', 'step');
      return (yield* Effect.promise(() => Bun.$`git -C ${root} rev-parse HEAD`.quiet().text())).trim();
    });
    const judged = (from: string, built: string, paths: readonly string[]) =>
      service.judge({ lane: 'landing', root, base: from, built, paths, places: ['packages/a'], inspection, debt: [] });

    yield* git('init', '-q');
    yield* write({ 'package.json': JSON.stringify({ workspaces: ['packages/*'] }) });
    for (const name of ['a', 'b', 'c'])
      yield* write({
        [`packages/${name}/package.json`]: JSON.stringify({
          name,
          exports: { '.': { bun: './main.ts' } },
          dependencies: name === 'a' ? { b: '*' } : {},
        }),
        [`packages/${name}/main.ts`]: name === 'a' ? "import 'b';" : 'export const value = 1;',
      });
    const base = yield* commit();
    yield* write({ 'packages/c/main.ts': "import 'node:fs';" });
    const outside = yield* commit();
    expect((yield* judged(base, outside, ['packages/c/main.ts'])).verdict.violations).toEqual([]);
    yield* write({ 'packages/b/main.ts': "import 'heavy';" });
    const bad = yield* commit();
    expect((yield* judged(outside, bad, ['packages/b/main.ts'])).verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual([
      'a [bun] -> heavy',
    ]);
    yield* write({ 'packages/b/main.ts': 'export const value = 2;' });
    const clean = yield* commit();
    expect((yield* judged(bad, clean, ['packages/b/main.ts'])).verdict.violations).toEqual([]);
    yield* write({ 'packages/b/main.ts': 'export const value = 3;' });
    const quiet = yield* commit();
    expect((yield* judged(clean, quiet, ['packages/b/main.ts'])).verdict.violations).toEqual([]);
    yield* write({ 'packages/b/main.ts': "import 'heavy';\nexport const value = 3;" });
    const worse = yield* commit();
    expect(
      (yield* judged(quiet, worse, ['packages/b/main.ts'])).verdict.violations.map(({ fingerprint, chain }) => ({ fingerprint, chain })),
    ).toEqual([{ fingerprint: 'a [bun] -> heavy', chain: ['packages/b/main.ts', 'heavy'] }]);
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
