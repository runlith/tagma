import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import type { Assembled } from '@tagma/inspection/builtins';
import { Effect, FileSystem } from 'effect';
import { dirname, join } from 'node:path';
import { inspections } from './inspectionLanes.js';

const PARAMS = {
  base: '',
  platforms: { node: { runtime: 'node', unmarked: true }, bun: { runtime: 'bun', unmarked: true } },
  shipped: 'bun',
  allows: {},
  refuses: { bun: ['node:fs'] },
  packages: {},
  apps: [],
  compiled: [],
  leaves: [],
  files: { extensions: ['.ts'], exclude: [] },
};
const inspection: Assembled = { builtin: 'platforms', params: { ...PARAMS, packages: { a: { loads: { bun: ['heavy'] } } } } };
const loading: Assembled = {
  builtin: 'platforms',
  params: {
    ...PARAMS,
    programs: [
      { at: 'packages/web/tool.ts', platform: 'bun' },
      { at: 'packages/web/aux.ts', platform: 'bun' },
    ],
  },
};

const repository = Effect.fnUntraced(function* (prefix: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix });
  const root = join(home, 'repo');
  const cacheRoot = join(home, 'cache');
  yield* fileSystem.makeDirectory(root);
  yield* fileSystem.makeDirectory(cacheRoot);
  const service = yield* Effect.acquireRelease(
    Effect.sync(() => inspections({ cacheRoot })),
    (held) => Effect.sync(() => held.close()),
  );
  const git = (...args: string[]) => Effect.promise(() => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet());
  const write = Effect.fnUntraced(function* (files: Record<string, string>, at = root) {
    for (const [path, text] of Object.entries(files)) {
      yield* fileSystem.makeDirectory(dirname(join(at, path)), { recursive: true });
      yield* fileSystem.writeFileString(join(at, path), text);
    }
  });
  const commit = Effect.fnUntraced(function* () {
    yield* git('add', '-A');
    yield* git('commit', '-qm', 'step');
    return (yield* Effect.promise(() => Bun.$`git -C ${root} rev-parse HEAD`.quiet().text())).trim();
  });
  yield* git('init', '-q');
  return { home, root, service, git, write, commit };
});

it.live('a sliced judgement governs its reach and still follows a changed foreign dependency', () =>
  Effect.gen(function* () {
    const { root, service, write, commit } = yield* repository('platform-reach-');
    const judged = (from: string, built: string, paths: readonly string[]) =>
      service.judge({ lane: 'landing', root, base: from, built, paths, places: ['packages/a'], inspection, debt: [] });

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

it.live(
  'judgements over one cache read what the checkout they name has installed now, through a reinstall, an uninstall and a repair',
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { home, root, service, git, write, commit } = yield* repository('platform-installed-');
      const checkout = join(home, 'worktree');
      const store = join(home, 'store/node_modules/@acme');
      const aliased = (to: string) =>
        write(
          { 'strict/strict.json': JSON.stringify({ compilerOptions: { paths: { '$x/*': [`\${configDir}/packages/web/${to}/*`] } } }) },
          store,
        );
      const linked = Effect.gen(function* () {
        yield* fileSystem.makeDirectory(join(checkout, 'node_modules/@acme'), { recursive: true });
        yield* fileSystem.symlink(join(store, 'tsconfig'), join(checkout, 'node_modules/@acme/tsconfig'));
      });
      const judged = (from: string, built: string, path: string) =>
        Effect.map(
          service.judge({ lane: 'merge', root, checkout, base: from, built, paths: [path], places: [''], inspection: loading, debt: [] }),
          ({ verdict }) => verdict.violations.map(({ fingerprint }) => fingerprint),
        );

      yield* write(
        {
          'tsconfig/package.json': JSON.stringify({ name: '@acme/tsconfig', version: '1.0.0' }),
          'tsconfig/base.json': JSON.stringify({ extends: '@acme/strict/strict.json' }),
          'strict/package.json': JSON.stringify({ name: '@acme/strict', version: '1.0.0' }),
        },
        store,
      );
      yield* aliased('clean');
      yield* write({
        '.gitignore': 'node_modules/\n',
        'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
        'tsconfig.json': JSON.stringify({ extends: '@acme/tsconfig/base.json' }),
        'packages/web/package.json': JSON.stringify({ name: 'web', exports: { '.': { bun: './main.ts' } } }),
        'packages/web/main.ts': "import { shared } from '$x/shared';\nexport const main = shared;\n",
        'packages/web/tool.ts': 'export const tool = 1;\n',
        'packages/web/aux.ts': 'export const aux = 1;\n',
        'packages/web/clean/shared.ts': 'export const shared = 1;\n',
        'packages/web/heavy/shared.ts': "import 'node:fs';\nexport const shared = 1;\n",
      });
      const seeded = yield* commit();
      yield* git('worktree', 'add', '-q', '--detach', checkout, seeded);
      yield* linked;
      yield* write({ 'packages/web/notes.ts': 'export const notes = 1;\n' });
      const noted = yield* commit();
      expect(yield* judged(seeded, noted, 'packages/web/notes.ts')).toEqual([]);
      yield* aliased('heavy');
      yield* write({ 'packages/web/more.ts': 'export const more = 1;\n' });
      const more = yield* commit();
      expect(yield* judged(noted, more, 'packages/web/more.ts')).toEqual([]);
      yield* write({ 'packages/web/tool.ts': "import './main';\nexport const tool = 1;\n" });
      const reached = yield* commit();
      expect(yield* judged(more, reached, 'packages/web/tool.ts')).toEqual(['packages/web/tool.ts [bun] -> node:fs']);
      yield* fileSystem.remove(join(checkout, 'node_modules'), { recursive: true });
      yield* write({ 'packages/web/later.ts': 'export const later = 1;\n' });
      const later = yield* commit();
      expect(yield* judged(reached, later, 'packages/web/later.ts')).toEqual([]);
      yield* linked;
      yield* write({ 'packages/web/aux.ts': "import './main';\nexport const aux = 1;\n" });
      const repaired = yield* commit();
      expect(yield* judged(later, repaired, 'packages/web/aux.ts')).toEqual(['packages/web/aux.ts [bun] -> node:fs']);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
