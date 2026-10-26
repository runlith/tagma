import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Assembled } from '@tagma/inspection/builtins';
import { answer } from './inspecting.js';

let template = '';
let root = '';
afterAll(() => rmSync(template, { recursive: true, force: true }));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'module-impact-'));
  cpSync(template, root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const git = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t -C ${root} ${args}`.quiet();
const commit = async (): Promise<string> => {
  await git('add', '-A');
  await git('commit', '-q', '-m', 'step');
  return (await git('rev-parse', 'HEAD').text()).trim();
};
const inspection: Assembled = {
  builtin: 'modules',
  params: {
    base: 'src',
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    conditions: [],
    files: { extensions: ['.ts'], exclude: [] },
    map: {
      modules: [
        { id: 'core', territory: ['src/core/'], entries: [{ at: 'src/core/' }] },
        { id: 'app', territory: ['src/app/'] },
      ],
      relations: [{ from: 'app', to: 'core' }],
      region: ['src/'],
    },
  },
};
let first = '';
let second = '';
let third = '';
beforeAll(async () => {
  template = mkdtempSync(join(tmpdir(), 'module-impact-'));
  root = template;
  await git('init', '-q');
  for (const [path, text] of Object.entries({
    'src/core/leaf.ts': 'export const x = 1;',
    'src/core/unrelated.ts': 'export const spare = 1;',
    'src/core/drift.ts': 'export const drift = 1;',
    'package.json': JSON.stringify({ name: 'fixture' }),
    'src/app/main.ts': "import { x } from '../core/leaf';",
    'src/core/unused.ts': 'export const unused = 1;',
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  first = await commit();
  rmSync(join(root, 'src/core/unused.ts'));
  second = await commit();
  rmSync(join(root, 'src/core/leaf.ts'));
  third = await commit();
});

let id = 0;
const judge = (base: string, built: string, paths: readonly string[]) =>
  answer(
    {
      id: ++id,
      kind: 'judge',
      lane: 'landing',
      root,
      base,
      built,
      paths,
      places: ['src'],
      inspection,
      debt: [],
      cacheRoot: join(root, '.git', 'facts'),
    },
    'judge',
  );

test('the persisted importer index judges deletions locally and recovers when a later ask returns to an older base', async () => {
  const cold = await judge(first, second, ['src/core/unused.ts']);
  expect(cold.answered && 'verdict' in cold && cold.verdict.violations).toEqual([]);
  const warm = await judge(second, third, ['src/core/leaf.ts']);
  const expected = ['app -> ../core/leaf unresolved @ app/main.ts'];
  expect(warm.answered && 'verdict' in warm && warm.verdict.violations.map((one) => one.fingerprint)).toEqual(expected);
  expect(warm.answered && warm.read.includes('src/core/unrelated.ts')).toBe(false);
  const back = await judge(first, second, ['src/core/unused.ts']);
  expect(back.answered && 'verdict' in back && back.verdict.violations).toEqual([]);
  const again = await judge(second, third, ['src/core/leaf.ts']);
  expect(again.answered && 'verdict' in again && again.verdict.violations.map((one) => one.fingerprint)).toEqual(expected);
  expect(again.answered && again.read.includes('src/core/unrelated.ts')).toBe(false);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { build: 'build' } }));
  const drift = await commit();
  rmSync(join(root, 'src/core/drift.ts'));
  const next = await commit();
  const advanced = await judge(drift, next, ['src/core/drift.ts']);
  expect(advanced.answered && 'verdict' in advanced && advanced.verdict.violations).toEqual([]);
  expect(advanced.answered && advanced.read.includes('src/core/unrelated.ts')).toBe(false);
});

test('export and card changes keep the importer index and judge only narrowed consumers', async () => {
  if (inspection.builtin !== 'modules') throw new Error('modules');
  const publicMap: Assembled = {
    builtin: 'modules',
    params: {
      ...inspection.params,
      map: {
        ...inspection.params.map,
        modules: [
          { id: 'core', territory: ['src/core/'], entries: [{ at: 'src/core/public.ts' }] },
          { id: 'app', territory: ['src/app/'] },
        ],
      },
    },
  };
  const manifest = 'src/core/package.json';
  const exports = { '.': './public.ts' };
  for (const [path, text] of Object.entries({
    'package.json': JSON.stringify({ workspaces: ['src/core'] }),
    [manifest]: JSON.stringify({ name: 'core-package', exports }),
    'src/core/public.ts': 'export const x = 1;',
    'src/core/fresh.ts': 'export const fresh = 1;',
    'src/core/seed.ts': 'export const seed = 1;',
    'src/app/main.ts': "import { x } from 'core-package';",
    'src/app/unrelated.ts': "import { x } from 'core-package';",
  }))
    writeFileSync(join(root, path), text);
  const start = await commit();
  rmSync(join(root, 'src/core/seed.ts'));
  const seeded = await commit();
  const check = (base: string, built: string, paths: readonly string[]) =>
    answer(
      {
        id: ++id,
        kind: 'judge',
        lane: 'landing',
        root,
        base,
        built,
        paths,
        places: ['src'],
        inspection: publicMap,
        debt: [],
        cacheRoot: join(root, '.git', 'facts'),
      },
      'judge',
    );
  expect((await check(start, seeded, ['src/core/seed.ts'])).answered).toBe(true);
  writeFileSync(join(root, manifest), JSON.stringify({ name: 'core-package', exports: { ...exports, './fresh': './fresh.ts' } }));
  const opened = await commit();
  const addition = await check(seeded, opened, [manifest]);
  expect(addition.answered && 'verdict' in addition && addition.verdict.violations).toEqual([]);
  expect(addition.answered && addition.read.filter((path) => path.startsWith('src/app/'))).toEqual([]);
  const openedMap: Assembled = {
    builtin: 'modules',
    params: {
      ...publicMap.params,
      map: {
        ...publicMap.params.map,
        modules: [
          { id: 'core', territory: ['src/core/'], entries: [{ at: 'src/core/public.ts' }, { at: 'src/core/fresh.ts' }] },
          { id: 'app', territory: ['src/app/'] },
        ],
      },
    },
  };
  const reach = (next: Assembled, prior: Assembled, commit: string) =>
    answer(
      {
        id: ++id,
        kind: 'reach',
        root,
        commit,
        inspection: next,
        places: ['src'],
        previous: { inspection: prior, fingerprints: [] },
        cacheRoot: join(root, '.git', 'facts'),
      },
      'reach',
    );
  const cardOpening = await reach(openedMap, publicMap, opened);
  expect(cardOpening.answered && cardOpening.read).toEqual([]);
  writeFileSync(join(root, 'src/app/fresh.ts'), "import { fresh } from 'core-package/fresh';");
  const consumer = await commit();
  const narrow = await reach(publicMap, openedMap, consumer);
  expect(narrow.answered && 'verdict' in narrow && narrow.verdict.violations.map((one) => one.fingerprint)).toEqual([
    'app -> core private @ app/fresh.ts',
  ]);
  expect(narrow.answered && narrow.read.includes('src/app/unrelated.ts')).toBe(false);
  writeFileSync(join(root, manifest), JSON.stringify({ name: 'core-package', exports }));
  const removed = await commit();
  const removal = await check(consumer, removed, [manifest]);
  expect(removal.answered && 'verdict' in removal && removal.verdict.violations.map((one) => one.fingerprint)).toEqual([
    'app -> core-package/fresh unresolved @ app/fresh.ts',
  ]);
  expect(removal.answered && removal.read.includes('src/app/unrelated.ts')).toBe(false);
});

test('a card narrowing that reuses the importer index refuses a copy the checkout’s generated config contradicts, naming both', async () => {
  const own = mkdtempSync(join(tmpdir(), 'module-copy-'));
  const at = (...args: string[]) => Bun.$`git -c user.name=t -c user.email=t@t -C ${own} ${args}`.quiet();
  const wrote = (path: string, text: string) => {
    mkdirSync(dirname(join(own, path)), { recursive: true });
    writeFileSync(join(own, path), text);
  };
  const committed = async (): Promise<string> => {
    await at('add', '-A');
    await at('commit', '-q', '-m', 'step');
    return (await at('rev-parse', 'HEAD').text()).trim();
  };
  const aliases = (target: string) => JSON.stringify({ compilerOptions: { paths: { '$core/*': [target] } } });
  const drawn = (entries: readonly { readonly at: string }[]): Assembled => ({
    builtin: 'modules',
    params: {
      base: '',
      built: [{ output: '.gen/tsconfig.json', source: 'gen.json', why: 'The committed copy of the generated config.' }],
      cycles: 'refuse',
      coverage: 'refuse',
      unresolved: 'refuse',
      reads: 'every',
      conditions: [],
      files: { extensions: ['.ts'], exclude: [] },
      map: {
        modules: [
          { id: 'core', territory: ['src/core/'], entries },
          { id: 'app', territory: ['src/app/'] },
        ],
        relations: [{ from: 'app', to: 'core' }],
        region: ['src/'],
      },
    },
  });
  const open = drawn([{ at: 'src/core/public.ts' }]);
  const closed = drawn([]);
  const asked = (posted: Record<string, unknown>, kind: 'judge' | 'reach') =>
    answer({ id: ++id, root: own, places: [''], cacheRoot: join(own, '.git', 'facts'), ...posted } as never, kind);
  try {
    await at('init', '-q');
    wrote('.gitignore', '.gen/\n');
    wrote('tsconfig.json', JSON.stringify({ extends: './.gen/tsconfig.json' }));
    wrote('gen.json', aliases('../src/core/*'));
    wrote('.gen/tsconfig.json', aliases('../src/core/*'));
    wrote('src/core/public.ts', 'export const x = 1;');
    wrote('src/core/seed.ts', 'export const seed = 1;');
    wrote('src/app/main.ts', "import { x } from '$core/public';");
    const start = await committed();
    rmSync(join(own, 'src/core/seed.ts'));
    const seeded = await committed();
    const warm = await asked(
      { kind: 'judge', lane: 'landing', base: start, built: seeded, paths: ['src/core/seed.ts'], inspection: open, debt: [] },
      'judge',
    );
    expect(warm.answered && 'verdict' in warm && warm.verdict.violations).toEqual([]);
    wrote('.gen/tsconfig.json', aliases('../src/app/*'));
    const narrowed = await asked(
      { kind: 'reach', commit: seeded, inspection: closed, previous: { inspection: open, fingerprints: [] } },
      'reach',
    );
    expect(narrowed.answered).toBe(false);
    expect(!narrowed.answered && narrowed.reason).toContain('`gen.json`');
    expect(!narrowed.answered && narrowed.reason).toContain('`.gen/tsconfig.json`');
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
});

test('an add-only ask refreshes shadowed resolution before a later deletion judges the newly exposed private target', async () => {
  if (inspection.builtin !== 'modules') throw new Error('modules');
  const shadow: Assembled = {
    builtin: 'modules',
    params: {
      ...inspection.params,
      map: {
        ...inspection.params.map,
        modules: [
          { id: 'core', territory: ['src/core/'], entries: [{ at: 'src/core/branch.ts' }] },
          { id: 'app', territory: ['src/app/'] },
        ],
      },
    },
  };
  mkdirSync(join(root, 'src/core/branch'), { recursive: true });
  writeFileSync(join(root, 'src/core/branch/index.ts'), 'export const branch = 1;');
  writeFileSync(join(root, 'src/core/seed.ts'), 'export const seed = 1;');
  writeFileSync(join(root, 'src/app/main.ts'), "import { branch } from '../core/branch';");
  const start = await commit();
  rmSync(join(root, 'src/core/seed.ts'));
  const seeded = await commit();
  const check = (base: string, built: string, paths: readonly string[]) =>
    answer(
      {
        id: ++id,
        kind: 'judge',
        lane: 'landing',
        root,
        base,
        built,
        paths,
        places: ['src'],
        inspection: shadow,
        debt: [],
        cacheRoot: join(root, '.git', 'facts'),
      },
      'judge',
    );
  const cold = await check(start, seeded, ['src/core/seed.ts']);
  expect(cold.answered && 'verdict' in cold && cold.verdict.violations).toEqual([]);
  writeFileSync(join(root, 'src/core/branch.ts'), 'export const branch = 2;');
  const added = await commit();
  const addition = await check(seeded, added, ['src/core/branch.ts']);
  expect(addition.answered && 'verdict' in addition && addition.verdict.violations).toEqual([]);
  rmSync(join(root, 'src/core/branch.ts'));
  const removed = await commit();
  const result = await check(added, removed, ['src/core/branch.ts']);
  expect(result.answered && 'verdict' in result && result.verdict.violations.map((one) => one.fingerprint)).toEqual([
    'app -> core private @ app/main.ts',
  ]);
});
