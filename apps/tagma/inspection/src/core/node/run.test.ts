import { describe, expect, it } from 'bun:test';
import type { FacetMemo, ParseMemo } from '@runlith/code-facts/blobs';
import { USAGE } from '@runlith/code-facts/js';
import type { Tree } from '@runlith/code-facts/tree';
import type { Inspection, Params } from '../../builtins';
import { ASK_BUDGET_MS, budgetOf, deriveCalibration, EnvelopeExceeded, unbounded } from './budget';
import { judge, judgeReadings } from './judge';
import type { MemoValue } from './memo';
import { listedOf, parseDiffTreeZero, parseTreeId } from './gitTrees';
import { lazySeedOf, repositoryPath, settled, settledLazy, slicedSide } from './run';
import { type Named, lazyCommitSide, overlaidSide } from './sides';
import { ready } from '../../builtins.node';

await ready('names');
await ready('platforms');
await ready('swallowed-failures');

const committed = new Map([
  ['src/a.ts', { object: 'oa', size: 10 }],
  ['src/b.ts', { object: 'ob', size: 10 }],
  ['src/gone.ts', { object: 'og', size: 10 }],
]);
const blobs: Record<string, string> = {
  oa: 'export const Alpha = 1;\n',
  ob: 'export const Beta = Alpha;\n',
  og: 'export const Gone = 1;\n',
};
const disk: Record<string, string> = {
  'src/a.ts': 'export const Gamma = 2;\n',
  'src/new.ts': 'export const Alpha = 3;\n',
  'other/x.ts': 'export const Alpha = 4;\n',
};

const side = (reads: string[], loads: string[][]) =>
  overlaidSide(
    committed,
    new Map([
      ['src/a.ts', { size: 24 }],
      ['src/new.ts', { size: 24 }],
      ['src/gone.ts', null],
      ['other/x.ts', { size: 24 }],
    ]),
    ['src/'],
    (wanted) => {
      loads.push(wanted.map(({ path }) => path));
      return new Map(wanted.map(({ object }) => [object, blobs[object] as string]));
    },
    (path) => {
      reads.push(path);
      return disk[path] as string;
    },
    (words) =>
      new Set(
        Object.entries({ 'src/a.ts': blobs.oa, 'src/b.ts': blobs.ob }).flatMap(([path, text]) =>
          words.some((word) => (text as string).includes(word)) ? [path] : [],
        ),
      ),
    new Map(),
    new Map(),
  );

describe('a check over named paths', () => {
  it('reads the named paths from the working tree and every other path from the commit', () => {
    const reads: string[] = [];
    const loads: string[][] = [];
    const over = side(reads, loads);
    expect([...over.paths].sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/new.ts']);
    expect(over.tree(undefined).snapshot?.startsWith('worktree\0')).toBe(true);
    const texts = settled([over], [['src/a.ts', 'src/b.ts', 'src/new.ts']], ([tree]) =>
      ['src/a.ts', 'src/b.ts', 'src/new.ts'].map((path) => tree?.read(path)),
    );
    expect(texts).toEqual([disk['src/a.ts'], blobs.ob, disk['src/new.ts']]);
    expect(loads.flat()).toEqual(['src/b.ts']);
    expect(reads.sort()).toEqual(['src/a.ts', 'src/new.ts']);
  });

  it('answers mentions from the named texts in place of the commit’s', () => {
    const reads: string[] = [];
    const tree = side(reads, []).tree(undefined);
    expect([...(tree.mentions?.(['Alpha']) ?? [])].sort()).toEqual(['src/b.ts', 'src/new.ts']);
    expect([...(tree.mentions?.(['Gamma']) ?? [])]).toEqual(['src/a.ts']);
    expect([...(tree.mentions?.(['Gam']) ?? [])]).toEqual([]);
    expect(reads.filter((path) => path === 'src/a.ts')).toHaveLength(1);
  });

  it('judges a named file the commit does not hold as added, and never reads a mention the listing does not hold', () => {
    const inspection: Inspection = {
      builtin: 'names',
      params: {
        base: 'src',
        files: { extensions: ['.ts'], exclude: [] },
        uncovered: [],
        modules: [{ id: 'm', territory: ['m/'] }],
        services: ['Context.Service'],
        errors: ['Error'],
        checks: { S4: { within: 'module', exempt: [] } },
        glossary: [],
      },
    };
    const held = new Map([['src/m/a.ts', { object: 'oa', size: 30 }]]);
    const blob: Record<string, string> = { oa: 'export type Row = { a: 1 };\n' };
    const written: Record<string, string> = { 'src/m/b.ts': 'export type Row = { b: 1 };\n' };
    const over = (named: Named) =>
      overlaidSide(
        held,
        named,
        ['src'],
        (wanted) => new Map(wanted.map(({ object }) => [object, blob[object] as string])),
        (path) => written[path] as string,
        (words) => new Set(words.some((word) => blob.oa?.includes(word)) ? ['src/m/a.ts', 'src/m/landedSince.ts'] : []),
        new Map(),
        new Map(),
      );
    const base = over(new Map());
    const built = over(new Map([['src/m/b.ts', { size: 30 }]]));
    const paths = ['src/m/b.ts'];
    const verdict = settled([base, built], [paths, paths], ([before, after]) =>
      judge(inspection, { base: before as Tree, built: after as Tree, paths }, [], unbounded()),
    );
    expect(verdict.violations.map(({ fingerprint }) => fingerprint)).toEqual(['S4 m:Row @ m/b.ts']);
    expect([...(built.tree(undefined).mentions?.(['Row']) ?? [])]).toEqual(['src/m/a.ts', 'src/m/b.ts']);
  });

  it('charges only fetched blobs, reusing a warm fact without spending the source envelope', () => {
    const over = side([], []);
    const budget = budgetOf('platforms', deriveCalibration(ASK_BUDGET_MS, 1, 1024 * 1024));
    expect(settled([over], [[]], ([tree]) => tree!.read('src/b.ts'), undefined, budget)).toBe(blobs.ob!);
    expect(settled([over], [[]], ([tree]) => tree!.read('src/b.ts'), undefined, budget)).toBe(blobs.ob!);
    expect(() => settled([over], [[]], ([tree]) => tree!.read('src/a.ts'), undefined, budget)).toThrow(EnvelopeExceeded);
  });

  it('publishes only settled memo writes and never a failed pass', () => {
    const stored = new Map<string, MemoValue>();
    const writes: MemoValue[] = [];
    const store = {
      get: (key: string) => stored.get(key),
      set: (key: string, value: MemoValue) => {
        writes.push(value);
        stored.set(key, value);
      },
    };
    const over = side([], []);
    const value = (text: string): MemoValue => ({ dependencies: [], listings: [], violations: [], read: [text] });
    const result = settled(
      [over],
      [[]],
      ([tree], memo) => {
        const text = tree!.read('src/b.ts');
        memo!.set('start', value(text));
        return text;
      },
      store,
    );
    expect(result).toBe(blobs.ob!);
    expect(writes).toEqual([value(blobs.ob!)]);
    expect(() =>
      settled(
        [over],
        [[]],
        (_, memo) => {
          memo!.set('failed', value('bad'));
          throw new Error('stopped');
        },
        store,
      ),
    ).toThrow();
    expect(stored.has('failed')).toBe(false);
  });

  it('gives separate overlays distinct identities even at the same path and size', () => {
    expect(side([], []).tree(undefined).object?.('src/a.ts')).not.toBe(side([], []).tree(undefined).object?.('src/a.ts'));
  });

  it('takes a path named absolute under the repository as one from its root', () => {
    expect(repositoryPath('/repo', '/repo/src/a.ts')).toBe('src/a.ts');
    expect(repositoryPath('/repo/', './src/a.ts')).toBe('src/a.ts');
  });
});

const usagePath = 'src/one.ts';
const usageText = (id: string) => `export const one = operation('${id}', { answer: arms({ ok: {} }) });`;
const usageParses: ParseMemo = new Map();
const usageFacts: FacetMemo = new Map();
const usageSide = (object: string, text: string) =>
  overlaidSide(
    new Map([[usagePath, { object, size: Buffer.byteLength(text) }]]),
    new Map(),
    [''],
    (wanted) => new Map(wanted.map(({ object: held }) => [held, text])),
    () => text,
    () => new Set<string>(),
    usageParses,
    usageFacts,
  );

it('shares one parsed usage fact across base and built trees of the same blob', () => {
  const base = usageSide('shared-blob', usageText('one'));
  const built = usageSide('shared-blob', usageText('one'));
  const changed = usageSide('changed-blob', usageText('two'));
  for (const at of [base, built, changed]) at.fetch([usagePath]);
  const held = base.tree(undefined).facet?.(usagePath, USAGE);
  expect(built.tree(undefined).facet?.(usagePath, USAGE)).toBe(held);
  expect(changed.tree(undefined).facet?.(usagePath, USAGE)).not.toBe(held);
  expect(
    changed
      .tree(undefined)
      .facet?.(usagePath, USAGE)
      ?.calls.find(({ callee }) => callee === 'operation')?.first,
  ).toBe('two');
});

const platformParams: Params<'platforms'> = {
  base: '',
  platforms: { browser: { runtime: 'browser' }, bun: { runtime: 'bun', unmarked: true } },
  shipped: 'bun',
  files: { extensions: ['.ts'], exclude: [] },
  allows: {},
  refuses: {},
  leaves: ['.json'],
  compiled: [],
  apps: [],
  packages: { a: { loads: { browser: ['sharp'] } } },
};
const platformInspection: Inspection = { builtin: 'platforms', params: platformParams };
const platformSide = (added: string) => {
  const texts = new Map(
    Object.entries({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({
        name: 'a',
        exports: { '.': { browser: './src/main.ts', default: './src/main.ts' } },
        dependencies: { b: '*' },
      }),
      'packages/a/src/main.ts': "import 'b';",
      'packages/b/package.json': JSON.stringify({ name: 'b', exports: { '.': { browser: './src/main.ts', default: './src/main.ts' } } }),
      'packages/b/src/main.ts': `import 'node:fs'; ${added}`,
    }),
  );
  const listed = new Map([...texts].map(([path, text]) => [path, { object: `${path}\0${text}`, size: text.length }]));
  const blobs = new Map([...listed].map(([path, { object }]) => [object, texts.get(path)!]));
  return overlaidSide(
    listed,
    new Map(),
    [''],
    (wanted) => new Map(wanted.map(({ object }) => [object, blobs.get(object)!])),
    () => {
      throw new Error('no working-tree reads');
    },
    () => new Set<string>(),
    new Map(),
    new Map(),
  );
};

it('judges divergent platform trees in independent bounded slices with the same change verdict as a whole walk', () => {
  const inspection = platformInspection;
  const base = platformSide(''),
    built = platformSide("import 'sharp';");
  const memo = new Map<string, MemoValue>();
  const envelope = { files: 4, mib: 1 };
  const before = slicedSide(inspection, base, [''], memo, envelope);
  const after = slicedSide(inspection, built, [''], memo, envelope);
  const paths = ['packages/b/src/main.ts'];
  const reading = settled([base, built], [[], []], ([a, b]) =>
    judgeReadings(inspection, { base: a!, built: b!, paths }, [], before, after, unbounded()),
  );
  const whole = settled([base, built], [[], []], ([a, b]) => judge(inspection, { base: a!, built: b!, paths }, [], unbounded()));
  expect(reading).toEqual(whole);
  expect(reading.violations.map(({ fingerprint }) => fingerprint)).toEqual(['a [browser] -> sharp']);
});

it('judges an indivisible platform package larger than the slice envelope on a slice of its own', () => {
  const built = platformSide("import 'sharp';");
  const tight = slicedSide(platformInspection, built, [''], new Map(), { files: 1, mib: 1 });
  const loose = slicedSide(platformInspection, platformSide("import 'sharp';"), [''], new Map(), { files: 100, mib: 32 });
  expect(tight).toEqual(loose);
  expect(tight.violations.map(({ fingerprint }) => fingerprint)).toEqual(['a [browser] -> sharp', 'b [browser] -> fs']);
});

it('charges an on-demand blob before fetching it', () => {
  const reading = usageSide('on-demand', usageText('one'));
  const budget = budgetOf('swallowed-failures', deriveCalibration(1, 0, 1024 * 1024));
  expect(() => settled([reading], [[]], ([tree]) => tree?.read(usagePath), undefined, budget)).toThrow(EnvelopeExceeded);
});

describe('tree-id identity and diff-tree plumbing', () => {
  it('takes the tree id from rev-parse output', () => {
    expect(parseTreeId('64ab56c18ab18df5ca702724865772f455ea1874\n')).toBe('64ab56c18ab18df5ca702724865772f455ea1874');
    expect(parseTreeId('aaa\nbbb\n')).toBe('aaa');
  });

  it('parses diff-tree zero records into before and after blob ids', () => {
    const zero = '0'.repeat(40);
    const old = 'b'.repeat(40);
    const next = 'd'.repeat(40);
    const output = `:100644 100644 ${old} ${next} M\0src/a.ts\0:100644 100644 ${zero} ${next} A\0src/new.ts\0:100644 100644 ${old} ${zero} D\0src/gone.ts\0`;
    expect(parseDiffTreeZero(output)).toEqual([
      { path: 'src/a.ts', before: old, after: next, status: 'M' },
      { path: 'src/new.ts', before: null, after: next, status: 'A' },
      { path: 'src/gone.ts', before: old, after: null, status: 'D' },
    ]);
  });

  it('parses ls-tree long zero records into objects and sizes', () => {
    const output = `100644 blob ${'a'.repeat(40)}      10\tsrc/a.ts\0${'120000 blob unrelated'} \0`;
    const listed = listedOf(output);
    expect(listed.get('src/a.ts')).toEqual({ object: 'a'.repeat(40), size: 10 });
    expect(listed.has('src/b.ts')).toBe(false);
  });

  it('seeds lazy listings from the complete diff, not the narrowed paths', () => {
    const entries = [{ path: 'src/b.ts', before: 'o', after: 'n', status: 'M' }];
    expect(lazySeedOf(entries, ['src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('marks unknown lazy paths provisional false and resolves them after a point fill', () => {
    const parses: ParseMemo = new Map();
    const facts: FacetMemo = new Map();
    const texts = new Map([['oa', 'export const a = 1;\n']]);
    const seed = new Map([['src/a.ts', { object: 'oa', size: 10 }]]);
    const change = { slot: 'repo', baseTree: 't1', builtTree: 't2', baseEntries: [] as const };
    const side = lazyCommitSide('repo', 't1', seed, ['src/'], parses, facts, { slot: 'repo', change });
    const before = side.tree(undefined);
    expect(before.has?.('src/a.ts')).toBe(true);
    expect(before.has?.('src/b.ts')).toBe(false);
    expect(before.object?.('src/b.ts')).toBeUndefined();
    expect([...side.drainUnknown()].sort()).toEqual(['src/b.ts']);
    side.fill(['src/b.ts'], new Map([['src/b.ts', { object: 'ob', size: 10 }]]));
    expect(side.drainUnknown()).toEqual([]);
    const after = side.tree(undefined);
    expect(after.has?.('src/b.ts')).toBe(true);
    expect(after.snapshot).toBe('t1');
    expect((after as unknown as { readonly slot: string }).slot).toBe('repo');
    expect(texts.get('oa')).toBe('export const a = 1;\n');
  });

  it('answers unknown lazy paths provisional false for the next point round', () => {
    const parses: ParseMemo = new Map();
    const facts: FacetMemo = new Map();
    const seed = new Map([['src/a.ts', { object: 'oa', size: 10 }]]);
    const change = { slot: 'repo', baseTree: 't1', builtTree: 't1', baseEntries: [] as const };
    const side = lazyCommitSide('repo', 't1', seed, ['src/'], parses, facts, { slot: 'repo', change });
    const found = settled([side], [[]], ([tree]) => (tree as Tree).has?.('src/missing.ts') === true);
    expect(found).toBe(false);
    expect(side.drainUnknown()).toEqual(['src/missing.ts']);
    void settledLazy;
  });
});
