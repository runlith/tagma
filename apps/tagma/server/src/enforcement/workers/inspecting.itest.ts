import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import type { Assembled } from '@tagma/inspection/builtins';
import { clearCalibrations, deriveCalibration, PROBE_MAX_FILES } from '@tagma/inspection/node/budget';
import { MEMO_BYTES } from '@tagma/inspection/node/memo';
import { createHash } from 'node:crypto';
import { openCache } from '../cache/store.js';
import { Git, gitLayer } from '@runlith/git/Git';
import { listedTreeAt, treeIdAt } from '@runlith/git/trees';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { answer } from './inspecting.js';
import { listingAt } from './treeMemo.js';

let template = '';
let root = '';
afterAll(() => rmSync(template, { recursive: true, force: true }));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tagma-inspecting-'));
  cpSync(template, root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet();

const write = (files: Record<string, string | Uint8Array>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

const commit = async (files: Record<string, string | Uint8Array>): Promise<string> => {
  write(files);
  await git('add', '--', ...Object.keys(files));
  await git('commit', '-q', '-m', 'step');
  return (await git('rev-parse', 'HEAD').text()).trim();
};

const inspection: Assembled = {
  builtin: 'loads',
  params: {
    base: 'app/src',
    from: ['core/'],
    refuses: ['@acme/client', 'heavy'],
    allows: ['@acme/client/models'],
    reads: 'static',
    conditions: [],
    files: { extensions: ['.ts'], exclude: [] },
    map: { modules: [], relations: [], region: [] },
  },
};

let first = '';

beforeAll(async () => {
  template = mkdtempSync(join(tmpdir(), 'tagma-inspecting-'));
  root = template;
  await git('init', '-q');
  first = await commit({
    'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*', 'app'] }),
    'app/package.json': JSON.stringify({ name: 'app' }),
    'packages/client/package.json': JSON.stringify({
      name: '@acme/client',
      exports: { '.': './src/index.ts', './models': './src/models.ts' },
    }),
    'packages/client/src/index.ts': "import 'heavy';\n",
    'packages/client/src/models.ts': "import { shape } from './shape.js';\nexport const model = shape;\n",
    'packages/client/src/shape.ts': "import 'heavy';\nexport const shape = 1;\n",
    'app/src/core/model.ts': "import { model } from '@acme/client/models';\n",
    'app/src/core/view.ts': 'export const view = 1;\n',
  });
});

let asked = 0;
const reach = (commitName: string) =>
  answer({ id: ++asked, kind: 'reach', root, commit: commitName, inspection, places: ['app/src'] }, 'reach');

test('a reach reads beyond its base from the committed tree, never the working tree, and names the files it read', async () => {
  write({ 'packages/client/src/shape.ts': 'export const shape = 1;\n' });
  const reply = await reach(first);
  const again = await reach(first);
  expect(again.answered && [...again.read].sort()).toEqual(reply.answered ? [...reply.read].sort() : []);
  expect(reply.answered && 'verdict' in reply && reply.verdict.violations).toEqual([
    {
      fingerprint: 'core/model.ts -> heavy',
      file: 'app/src/core/model.ts',
      line: 1,
      specifier: '@acme/client/models',
      chain: ['packages/client/src/models.ts', 'packages/client/src/shape.ts', 'heavy'],
      message: 'loads `heavy`',
      fix: expect.any(String),
    },
  ]);
  expect(reply.answered && [...reply.read].sort()).toEqual([
    'app/package.json',
    'app/src/core/model.ts',
    'app/src/core/view.ts',
    'package.json',
    'packages/client/package.json',
    'packages/client/src/models.ts',
    'packages/client/src/shape.ts',
  ]);
});

test('a change is judged new only where its own selected file newly loads what is refused', async () => {
  const built = await commit({ 'app/src/core/view.ts': "import { model } from './model.js';\nexport const view = model;\n" });
  const judged = (debt: readonly string[]) =>
    answer(
      {
        id: ++asked,
        kind: 'judge',
        lane: 'landing',
        root,
        base: first,
        built,
        paths: ['app/src/core/view.ts'],
        places: ['app/src'],
        inspection,
        debt,
      },
      'judge',
    );
  const fresh = await judged([]);
  expect(
    fresh.answered && 'verdict' in fresh && fresh.verdict.violations.map(({ fingerprint, chain }) => ({ fingerprint, chain })),
  ).toEqual([
    {
      fingerprint: 'core/view.ts -> heavy',
      chain: ['app/src/core/model.ts', 'packages/client/src/models.ts', 'packages/client/src/shape.ts', 'heavy'],
    },
  ]);
  const owed = await judged(['core/view.ts -> heavy']);
  expect(owed.answered && 'verdict' in owed && owed.verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual([
    'core/view.ts -> heavy',
  ]);
  const held = await answer(
    {
      id: ++asked,
      kind: 'judge',
      lane: 'landing',
      root,
      base: built,
      built,
      paths: ['app/src/core/view.ts'],
      places: ['app/src'],
      inspection,
      debt: [],
    },
    'judge',
  );
  expect(held.answered && 'verdict' in held && held.verdict.violations).toEqual([]);
});

test('a reached blob that is not UTF-8 text fails the reading, naming its path', async () => {
  const broken = await commit({ 'packages/client/src/shape.ts': new Uint8Array([0xff, 0xfe, 0x00, 0x41]) });
  const reply = await reach(broken);
  expect(reply.answered).toBe(false);
  expect(!reply.answered && reply.reason).toContain('packages/client/src/shape.ts');
});

it.live('a tree listed after a neighbour equals the listing git gives it, across an addition, an edit and a deletion', () =>
  Effect.gen(function* () {
    const listed = Effect.fnUntraced(function* (commitName: string, fresh: boolean) {
      const git = yield* Git;
      const tree = yield* treeIdAt(git, root, commitName);
      return fresh ? (yield* listedTreeAt(git, root, tree, [''])).listing : yield* listingAt(git, root, commitName, ['']);
    });
    const same = Effect.fnUntraced(function* (commitName: string) {
      const derived = yield* listed(commitName, false);
      const fresh = yield* listed(commitName, true);
      expect([...derived.ordered]).toEqual([...fresh.ordered]);
      expect(new Map(derived.objects)).toEqual(new Map(fresh.objects));
      expect(new Map(derived.sizes)).toEqual(new Map(fresh.sizes));
      expect([...fresh.ordered].map((path) => derived.objects.get(path))).toEqual(
        [...fresh.ordered].map((path) => fresh.objects.get(path)),
      );
    });
    yield* listed(first, false);
    const next = yield* Effect.promise(async () => {
      write({ 'app/src/core/added.ts': 'export const added = 1;\n', 'app/src/core/view.ts': 'export const view = 2;\n' });
      await git('add', '--', 'app/src/core/added.ts', 'app/src/core/view.ts');
      await git('rm', '-q', '--', 'app/src/core/model.ts');
      await git('commit', '-q', '-m', 'step');
      return (await git('rev-parse', 'HEAD').text()).trim();
    });
    yield* same(next);
    yield* same(yield* Effect.promise(() => commit({ 'app/src/core/view.ts': 'export const view = 3;\n' })));
    yield* same(yield* Effect.promise(() => commit({ 'app/src/core/added.ts': 'export const added = 2;\n' })));
  }).pipe(
    Effect.provide(
      gitLayer.pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer))))),
    ),
  ),
);

test('a persisted over-budget estimate is remeasured before refusing a feasible reach', async () => {
  const at = await commit({
    'app/src/core/recovery.ts': `import { Effect } from 'effect';\nexport const read = Effect.fail('lost').pipe(Effect.orElseSucceed(() => false));\nexport const payload = '${'x'.repeat(8192)}';\n`,
  });
  const cacheRoot = join(root, 'inspection-cache');
  const common = (await git('rev-parse', '--path-format=absolute', '--git-common-dir').text()).trim();
  const cache = openCache(join(cacheRoot, `${createHash('sha256').update(common).digest('hex')}.sqlite`), MEMO_BYTES, (cause) => {
    throw cause;
  });
  cache.calibration.set('swallowed-failures', deriveCalibration(229, 16, 16));
  cache.close();
  const reply = await answer(
    {
      id: ++asked,
      kind: 'reach',
      root,
      commit: at,
      cacheRoot,
      places: ['app/src'],
      inspection: {
        builtin: 'swallowed-failures',
        params: { base: 'app/src', region: ['core/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] },
      },
    },
    'reach',
  );
  if (!reply.answered || !('verdict' in reply)) throw new Error(JSON.stringify(reply));
  expect(reply.verdict.violations.map((violation) => violation.file)).toEqual(['app/src/core/recovery.ts']);
});

test('a fresh worker judges a change past its probe on the calibration that change measures', async () => {
  clearCalibrations();
  const files = Object.fromEntries(
    Array.from({ length: PROBE_MAX_FILES + 1 }, (_, at) => [`app/src/core/wide${at}.ts`, `export const wide${at} = ${at};\n`]),
  );
  const built = await commit(files);
  const reply = await answer(
    {
      id: ++asked,
      kind: 'judge',
      lane: 'landing',
      root,
      base: first,
      built,
      paths: Object.keys(files),
      places: ['app/src'],
      debt: [],
      inspection: {
        builtin: 'swallowed-failures',
        params: { base: 'app/src', region: ['core/'], files: { extensions: ['.ts'], exclude: [] }, allow: [] },
      },
    },
    'judge',
  );
  if (!reply.answered || !('verdict' in reply)) throw new Error(JSON.stringify(reply));
  expect(reply.verdict).toEqual({ violations: [], unjudged: [] });
});

test('cold calibration permits repairing an unreadable base and leaves unsupported files to the judge', async () => {
  const paths = ['app/src/core/calibration.ts', 'app/src/core/calibration.odd'];
  const base = await commit({ [paths[0]!]: 'export const = ;\n', [paths[1]!]: 'before\n' });
  const built = await commit({ [paths[0]!]: 'export const repaired = 1;\nexport const other = 2;\n', [paths[1]!]: 'after\n' });
  const reply = await answer(
    {
      id: ++asked,
      kind: 'judge',
      lane: 'landing',
      root,
      base,
      built,
      paths,
      places: ['app/src'],
      debt: [],
      inspection: {
        builtin: 'size',
        params: {
          base: 'app/src',
          files: { extensions: ['.ts', '.odd'], exclude: [] },
          thresholds: [{ glob: '**/*', metric: 'non-import', lines: 1 }],
        },
      },
    },
    'judge',
  );
  if (!reply.answered || !('verdict' in reply)) throw new Error(JSON.stringify(reply));
  expect(reply.verdict.violations.map(({ file }) => file)).toEqual([paths[0]!]);
});
