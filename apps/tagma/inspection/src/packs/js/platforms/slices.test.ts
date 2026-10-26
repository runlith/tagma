import { describe, expect, it } from 'bun:test';
import { js } from '@runlith/code-facts/adapters';
import type { ImportSite } from '@runlith/code-facts/imports';
import { sitesOf, type Tree } from '@runlith/code-facts/tree';
import type { Params } from '../../../builtins';
import {
  type Change as Moved,
  Dependents,
  type InspectionMemo,
  type MemoStats,
  type MemoValue,
  memoWrites,
  Validity,
} from '../../../core/node/memo';
import { carries } from './carry';
import { ClosureExceeded, type File, reachOf } from './closure';
import { mergeSlices, type Plan, schedule, type Scope, type Sliced } from '../../../core/node/slices';
import { planSlices } from './plan';
import { unitObjects } from './records';
import { snapshotOf } from './snapshot';
import { readSlice } from './walk';

const files = { extensions: ['.ts', '.js', '.svelte'], exclude: ['**/*.test.ts'] };
const params: Params<'platforms'> = {
  base: '',
  platforms: {
    browser: { runtime: 'browser' },
    ssr: { runtime: 'node' },
    node: { runtime: 'node', unmarked: true },
    bun: { runtime: 'bun', unmarked: true },
  },
  shipped: 'bun',
  rendering: { client: 'browser', server: 'ssr' },
  allows: {},
  refuses: { bun: ['sharp'] },
  apps: [
    {
      at: 'apps/web',
      roots: ['src'],
      internal: [],
      server: ['src/routes/**/+server.ts'],
      routes: {
        at: 'src/routes',
        pages: ['+page.svelte', '+page.ts'],
        layouts: ['+layout.svelte', '+layout.ts'],
        option: { export: 'ssr', off: [false], pages: ['+page.ts'], layouts: ['+layout.ts'] },
      },
      files,
    },
  ],
  compiled: [],
  leaves: ['.css', '.json'],
  files,
  packages: {
    core: { names: ['zod'] },
    ui: { loads: { browser: ['effect/http'] } },
    nodey: { loads: { bun: ['ws-lib'], ssr: ['ws-lib'] } },
  },
  programs: [{ at: 'tools/run.ts', platform: 'bun' }],
};
const manifest = (name: string, exports: unknown, dependencies: readonly string[] = [], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, exports, dependencies: Object.fromEntries(dependencies.map((one) => [one, '*'])), ...extra });
const browser = (file: string) => ({ '.': { browser: file, default: file } });
const repository = (): Map<string, string> =>
  new Map(
    Object.entries({
      'package.json': JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }),
      'packages/core/package.json': manifest('core', browser('./src/main.ts')),
      'packages/core/src/main.ts': "import './deep'; export const core = 1;",
      'packages/core/src/deep.ts': "import 'node:fs'; import 'effect/http'; import 'right';",
      'packages/core/src/types.ts': "import type { Z } from 'zod';",
      'packages/ui/package.json': manifest('ui', browser('./src/main.ts'), ['core']),
      'packages/ui/src/main.ts': "import 'core'; export const ui = 1;",
      'packages/nodey/package.json': manifest('nodey', { '.': { node: './src/main.ts', default: './src/main.ts' } }),
      'packages/nodey/src/main.ts': "import 'ws-lib'; import 'bun:sqlite';",
      'packages/server/package.json': manifest('server', { '.': { bun: './src/main.ts', default: './src/main.ts' } }, ['ui', 'nodey'], {
        bin: { srv: './src/cli.ts' },
      }),
      'packages/server/src/main.ts': 'export const server = 1;',
      'packages/server/src/cli.ts': "import 'ui'; import 'nodey'; new Worker(new URL('./worker.ts', import.meta.url));",
      'packages/server/src/worker.ts': "import 'sharp';",
      'packages/left/package.json': manifest('left', browser('./src/main.ts'), ['right']),
      'packages/left/src/main.ts': "import 'right'; export const left = 1;",
      'packages/right/package.json': manifest('right', browser('./src/main.ts')),
      'packages/right/src/main.ts': "import 'left'; import 'node:path'; export const right = 1;",
      'apps/web/package.json': manifest('web', {}, ['ui', 'core']),
      'apps/web/src/page.ts': "import 'ui'; import 'core'; import './local';",
      'apps/web/src/local.ts': "import 'node:crypto';",
      'apps/web/src/routes/+page.ts': "export const ssr = false; import '../local';",
      'tools/run.ts': "import 'core'; import './helper';",
      'tools/helper.ts': "import 'sharp';",
    }),
  );
const treeOf = (texts: Map<string, string>, reads?: Set<string>): Tree => ({
  has: (path) => texts.has(path),
  paths: () => texts.keys(),
  object: (path) => texts.get(path),
  size: (path) => texts.get(path)?.length,
  read: (path) => {
    const text = texts.get(path);
    if (text === undefined) throw new Error(`Unread ${path}`);
    reads?.add(path);
    return text;
  },
});
const whole = (texts: Map<string, string>, memo?: InspectionMemo) =>
  mergeSlices([readSlice(params, treeOf(texts), { parts: 'whole', entries: [] }, memo)]);
const ownerOf = (path: string): string | null => /^(?:packages|apps)\/([^/]+)\//.exec(path)?.[1] ?? null;
const named = (path: string): string | null => {
  const dir = ownerOf(path);
  return dir === null ? null : dir === 'web' ? 'web' : dir;
};

type Asked = { readonly scope: Scope; readonly reads: ReadonlySet<string>; readonly sliced: Sliced; readonly walked: number };

const sliced = (
  texts: Map<string, string>,
  places: readonly string[],
  stored: Map<string, MemoValue>,
  envelope = { files: 15, mib: 32 },
  validity?: Validity,
) => {
  const prepared = snapshotOf(params, treeOf(texts));
  const plan = planSlices(params, treeOf(texts), places, envelope, prepared);
  const run = schedule(plan);
  const trusted = new Map<string, MemoValue>();
  const asks: Asked[] = [];
  for (let step = run.next(); step !== undefined; step = run.next()) {
    const reads = new Set<string>();
    const stats: MemoStats = { starts: 0, walked: 0, blobs: 0 };
    const writes = memoWrites(
      {
        get: (key) => stored.get(key),
        set: (key, value) => {
          stored.set(key, value);
        },
        stats,
      },
      undefined,
      validity,
    );
    const kept = memoWrites(trusted);
    const answer = readSlice(params, treeOf(texts, reads), step.scope, writes, kept, prepared, places);
    if (answer.needs.length === 0) {
      writes.commit();
      kept.commit();
    }
    asks.push({ scope: step.scope, reads, sliced: answer, walked: stats.walked });
    run.answer(step, answer);
  }
  return { plan, asks, reading: mergeSlices(run.readings()) };
};

const owners = (scope: Scope): ReadonlySet<string | null> =>
  new Set(scope.parts === 'whole' ? [] : scope.parts.map((part) => part.package));

describe('platform slices', () => {
  it('answers exactly what one whole walk answers, across doors, workers, discovered doors, outliers and a package cycle', () => {
    const texts = repository();
    const expected = whole(texts);
    const fingerprints = expected.violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('ui [browser] -> effect/http');
    expect(fingerprints).toContain('core [browser] -> fs');
    expect(fingerprints).toContain('nodey [bun] -> ws-lib');
    expect(fingerprints).toContain('packages/server/src/worker.ts [bun] -> sharp');
    expect(fingerprints).toContain('tools/run.ts [bun] -> sharp');
    expect(fingerprints).toContain('server#bin/srv [bun] -> ui (no bun)');
    expect(fingerprints).toContain('packages/core/src/types.ts -> zod (names)');
    const { plan, asks, reading } = sliced(texts, [''], new Map());
    expect(plan.slices.length).toBeGreaterThan(1);
    expect(asks.some(({ scope }) => owners(scope).has('left') && owners(scope).has('right'))).toBe(true);
    expect(reading).toEqual(expected);
  });

  it('keeps each slice ask inside the files its scope owns, beside the workspace manifests', () => {
    const texts = repository();
    for (const { scope, reads } of sliced(texts, [''], new Map()).asks) {
      const owned = owners(scope);
      for (const path of reads) if (!path.endsWith('package.json')) expect(owned.has(named(path))).toBe(true);
    }
  });

  it('answers the same from a warm store, walking no start and reading no source', () => {
    const texts = repository();
    const stored = new Map<string, MemoValue>();
    const cold = sliced(texts, [''], stored);
    const warm = sliced(texts, [''], stored);
    expect(warm.reading).toEqual(cold.reading);
    expect(warm.asks.every(({ walked }) => walked === 0)).toBe(true);
    expect(warm.asks.every(({ reads }) => [...reads].every((path) => path.endsWith('package.json')))).toBe(true);
    expect(whole(texts, { get: (key) => stored.get(key), set: () => undefined })).toEqual(cold.reading);
  });

  it('re-walks only the slices a one-file change reaches and still matches the whole walk', () => {
    const texts = repository();
    const stored = new Map<string, MemoValue>();
    const single = { files: 15, mib: 32 };
    sliced(texts, [''], stored, single);
    texts.set('packages/core/src/deep.ts', "import 'node:os'; import 'right';");
    const changed = sliced(texts, [''], stored, single);
    expect(changed.reading).toEqual(whole(texts));
    const walked = changed.asks.filter(({ walked }) => walked > 0).flatMap(({ scope }) => [...owners(scope)]);
    expect(walked).toContain('core');
    expect(changed.asks.every(({ reads }) => !reads.has('packages/nodey/src/main.ts'))).toBe(true);
  });

  it('carries a reading across edits that move no load, route option or file, and never across a refused import', () => {
    const texts = repository();
    const cached: Tree = {
      ...treeOf(texts),
      sites: (path) => sitesOf(treeOf(texts), path, [js]).map((site) => Object.fromEntries(Object.entries(site).reverse()) as ImportSite),
    };
    const edited = (edits: Record<string, string>) => {
      const after = new Map([...texts, ...Object.entries(edits)]);
      const changes = Object.keys(edits).map((path) => ({ path, before: texts.get(path) ?? null, after: after.get(path) ?? null }));
      return { carried: carries(params, cached, treeOf(after), changes), reading: whole(after) };
    };
    const quiet = edited({ 'packages/core/src/main.ts': "import './deep'; export const core = 2;" });
    expect(quiet).toEqual({ carried: true, reading: whole(texts) });
    expect(edited({ 'apps/web/src/routes/+page.ts': "export const ssr = true; import '../local';" }).carried).toBe(false);
    const loaded = edited({
      'packages/core/src/deep.ts': "import 'node:fs'; import 'effect/http'; import 'right'; import 'node:child_process';",
    });
    expect(loaded.carried).toBe(false);
    expect(loaded.reading.violations.find(({ fingerprint }) => fingerprint === 'core [browser] -> child_process')?.chain).toEqual([
      'packages/core/src/deep.ts',
      'node:child_process',
    ]);
    const refused = edited({ 'packages/core/src/main.ts': "import './deep'; import { z } from 'zod'; export const core = 1;" });
    expect(refused.carried).toBe(false);
    expect(refused.reading.violations.find(({ fingerprint }) => fingerprint === 'packages/core/src/main.ts -> zod (names)')?.chain).toEqual(
      ['zod'],
    );
  });

  it('refuses a plan exactly when one group grows past the headroom the plan reported', () => {
    const texts = repository();
    const big = 'packages/core/src/big.ts';
    texts.set(big, `export const big = '${'x'.repeat(4000)}';`);
    const loose = planSlices(params, treeOf(texts), [''], { files: 50, mib: 1 });
    const envelope = { files: 50, mib: 1 - (loose.headroom - 100) / (1024 * 1024) };
    expect(planSlices(params, treeOf(texts), [''], envelope).headroom).toBe(100);
    const grown = (by: number) =>
      planSlices(params, treeOf(new Map([...texts, [big, texts.get(big)!.replace("'x", `'${'y'.repeat(by)}x`)]])), [''], envelope);
    expect(grown(100).headroom).toBe(0);
    expect(() => grown(101)).toThrow('exceeds its per-slice source envelope');
  });

  it('judges only the narrowed place and reads other packages only through their own frontier asks', () => {
    const texts = repository();
    const { asks, reading } = sliced(texts, ['packages/ui'], new Map());
    const expected = whole(texts).violations.map(({ fingerprint }) => fingerprint);
    const fingerprints = reading.violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('ui [browser] -> effect/http');
    expect(fingerprints.every((one) => expected.includes(one))).toBe(true);
    expect(fingerprints.some((one) => one.startsWith('core [') || one.startsWith('server'))).toBe(false);
    const judged = asks.filter(({ scope }) => scope.parts !== 'whole' && scope.parts.some((part) => part.judged));
    for (const { reads } of judged) for (const path of reads) if (!path.endsWith('package.json')) expect(named(path)).toBe('ui');
  });

  it('keeps discovered doors and worker starts specific to the law reach, whichever reach warms the store', () => {
    const texts = repository();
    texts.set('packages/a/package.json', manifest('a', { '.': { bun: './src/main.ts' } }, ['b']));
    texts.set('packages/a/src/main.ts', "import 'b';");
    texts.set('packages/b/package.json', manifest('b', { '.': { node: './src/main.ts', default: './src/main.ts' } }));
    texts.set('packages/b/src/main.ts', "import 'sharp';");
    texts.set('packages/ui/src/main.ts', "new Worker(new URL('../../../apps/web/src/worker.ts', import.meta.url));");
    texts.set('apps/web/src/worker.ts', "import 'effect/http';");
    const narrow = ['packages/a', 'packages/ui'];
    const expected = sliced(texts, narrow, new Map()).reading;
    expect(expected.violations.map(({ fingerprint }) => fingerprint)).toContain('apps/web/src/worker.ts [browser] -> effect/http');
    expect(whole(texts).violations.map(({ fingerprint }) => fingerprint)).toContain('b [bun] -> sharp');
    for (const first of [narrow, ['']]) {
      const stored = new Map<string, MemoValue>();
      sliced(texts, first, stored);
      expect(sliced(texts, narrow, stored).reading).toEqual(expected);
      expect(sliced(texts, [''], stored).reading).toEqual(whole(texts));
    }
  });

  it('answers the same when the backing store drops parents between frontier asks', () => {
    class Evicting extends Map<string, MemoValue> {
      override get(key: string): MemoValue | undefined {
        for (const held of this.keys()) if (held.startsWith('platforms/dependencies/')) this.delete(held);
        return super.get(key);
      }
    }
    const texts = repository();
    expect(sliced(texts, [''], new Evicting()).reading).toEqual(whole(texts));
  });

  it('packs independent components within the source envelope', () => {
    const plan = planSlices(params, treeOf(repository()), [''], { files: 100, mib: 32 });
    expect(plan.slices.findIndex(({ parts }) => parts.some((part) => part.package === 'core'))).toBe(
      plan.slices.findIndex(({ parts }) => parts.some((part) => part.package === 'ui')),
    );
  });

  it('refuses an indivisible package beyond one slice envelope by name', () => {
    const texts = repository();
    for (let at = 0; at < 20; at += 1) texts.set(`packages/server/src/part${at}.ts`, 'export {};');
    expect(() => planSlices(params, treeOf(texts), [''], { files: 20, mib: 32 })).toThrow(/indivisible package group server/);
  });
});

describe('a change read from a store warmed on its base', () => {
  type Change = readonly [string, (texts: Map<string, string>) => void];
  const changes: readonly Change[] = [
    [
      'an edit deep in a closure',
      (texts) => {
        texts.set('packages/core/src/deep.ts', "import 'node:os'; import 'right';");
      },
    ],
    [
      'an added file an import probed absent',
      (texts) => {
        texts.set('apps/web/src/page.ts', "import 'ui'; import 'core'; import './local'; import './later';");
        texts.set('apps/web/src/later.ts', "import 'node:zlib';");
      },
    ],
    [
      'an added start in a new directory',
      (texts) => {
        texts.set('apps/web/src/fresh/start.ts', "import 'node:dns';");
      },
    ],
    [
      'a deleted target',
      (texts) => {
        texts.delete('packages/core/src/deep.ts');
      },
    ],
    [
      'an exports change',
      (texts) => {
        texts.set('packages/ui/package.json', manifest('ui', { '.': { node: './src/main.ts', default: './src/main.ts' } }, ['core']));
      },
    ],
    [
      'an entry point change',
      (texts) => {
        texts.set(
          'packages/server/package.json',
          manifest('server', { '.': { bun: './src/main.ts', default: './src/main.ts' } }, ['ui', 'nodey'], {
            bin: { srv: './src/other.ts' },
          }),
        );
        texts.set('packages/server/src/other.ts', "import 'sharp'; import 'bun:ffi';");
      },
    ],
  ];

  const diff = (from: Map<string, string>, to: Map<string, string>): readonly Moved[] =>
    [...new Set([...from.keys(), ...to.keys()])]
      .filter((path) => from.get(path) !== to.get(path))
      .map((path) => ({ path, before: from.get(path) ?? null, after: to.get(path) ?? null }));

  for (const [name, change] of changes) {
    it(`equals a fresh reading of both sides for ${name}, and of the base again after it`, () => {
      const stored = new Map<string, MemoValue>();
      const base = repository();
      sliced(base, [''], stored);
      const changed = new Map(base);
      change(changed);
      expect(sliced(base, [''], stored).reading).toEqual(whole(base));
      expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
      expect(sliced(base, [''], stored).reading).toEqual(whole(base));
      expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
    });

    it(`lists and plans ${name} from the base's snapshot exactly as from the changed tree itself`, () => {
      const envelope = { files: 15, mib: 32 };
      const units = [
        'packages/core/**/',
        'packages/core/src/',
        'packages/core/src/fresh/',
        'apps/web/src/',
        'apps/web/src/fresh/',
        'packages/server/**/',
        '/',
      ];
      const base = repository();
      const near = snapshotOf(params, treeOf(base));
      planSlices(params, treeOf(base), [''], envelope, near);
      for (const unit of units) unitObjects(treeOf(base), near.units)!(unit);
      const changed = new Map(base);
      change(changed);
      const derived = snapshotOf(params, treeOf(changed), { snapshot: near, changes: diff(base, changed) });
      const fresh = snapshotOf(params, treeOf(changed));
      expect([...derived.paths]).toEqual([...fresh.paths]);
      expect(new Map(derived.packagePaths)).toEqual(new Map(fresh.packagePaths));
      expect(planSlices(params, treeOf(changed), [''], envelope, derived)).toEqual(
        planSlices(params, treeOf(changed), [''], envelope, fresh),
      );
      expect(units.map(unitObjects(treeOf(changed), derived.units)!)).toEqual(units.map(unitObjects(treeOf(changed), fresh.units)!));
    });

    it(`equals a fresh reading of both sides for ${name} when validity is carried from tree to tree by their difference`, () => {
      const stored = new Map<string, MemoValue>();
      const envelope = { files: 15, mib: 32 };
      const base = repository();
      const atBase = Validity.fresh(new Dependents(10_000));
      sliced(base, [''], stored, envelope, atBase);
      const changed = new Map(base);
      change(changed);
      const atChanged = atBase.derive(diff(base, changed));
      expect(sliced(changed, [''], stored, envelope, atChanged).reading).toEqual(whole(changed));
      expect(sliced(base, [''], stored, envelope, atBase).reading).toEqual(whole(base));
      const back = atChanged.derive(diff(changed, base));
      expect(sliced(base, [''], stored, envelope, back).reading).toEqual(whole(base));
      expect(sliced(changed, [''], stored, envelope, back.derive(diff(base, changed))).reading).toEqual(whole(changed));
    });
  }

  it('answers a fresh reading when the store lost values a carried validity still vouches for', () => {
    const stored = new Map<string, MemoValue>();
    const texts = repository();
    const validity = Validity.fresh(new Dependents(10_000));
    sliced(texts, [''], stored, undefined, validity);
    sliced(texts, [''], stored, undefined, validity);
    for (const key of [...stored.keys()]) if (key.startsWith('platforms/dependencies/')) stored.delete(key);
    expect(sliced(texts, [''], stored, undefined, validity).reading).toEqual(whole(texts));
  });

  it('keeps a discovered start its first discoverer drops while another unchanged importer still reaches it', () => {
    const stored = new Map<string, MemoValue>();
    const base = repository();
    base.set('packages/a/package.json', manifest('a', { '.': { bun: './src/main.ts', default: './src/main.ts' } }, ['b']));
    base.set('packages/a/src/main.ts', "import 'b';");
    base.set('packages/c/package.json', manifest('c', { '.': { bun: './src/main.ts', default: './src/main.ts' } }, ['b']));
    base.set('packages/c/src/main.ts', "import 'b';");
    base.set('packages/b/package.json', manifest('b', { '.': { node: './src/main.ts', default: './src/main.ts' } }));
    base.set('packages/b/src/main.ts', "import 'sharp';");
    expect(sliced(base, [''], stored).reading).toEqual(whole(base));
    const changed = new Map(base);
    changed.set('packages/a/src/main.ts', 'export {};');
    expect(whole(changed).violations.map(({ fingerprint }) => fingerprint)).toContain('b [bun] -> sharp');
    expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
  });

  it('keeps a worker an unchanged app starts from becoming a start of the package that discovers it', () => {
    const stored = new Map<string, MemoValue>();
    const base = repository();
    base.set(
      'packages/ui/src/main.ts',
      "import 'core'; new Worker(new URL('../../../apps/web/src/worker.ts', import.meta.url)); export const ui = 1;",
    );
    base.set('apps/web/src/worker.ts', "import 'effect/http';");
    expect(sliced(base, [''], stored).reading).toEqual(whole(base));
    const changed = new Map(base);
    changed.set('packages/ui/src/main.ts', `${base.get('packages/ui/src/main.ts')} export const more = 2;`);
    expect(whole(changed).violations.map(({ fingerprint }) => fingerprint)).not.toContain(
      'apps/web/src/worker.ts [browser] -> effect/http',
    );
    expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
  });

  it('reads and walks nothing of the packages an edit cannot reach', () => {
    const stored = new Map<string, MemoValue>();
    const texts = repository();
    sliced(texts, [''], stored);
    texts.set('packages/nodey/src/main.ts', "import 'ws-lib'; import 'bun:sqlite'; import 'node:os';");
    const { asks, reading } = sliced(texts, [''], stored);
    expect(reading).toEqual(whole(texts));
    const read = new Set(asks.flatMap(({ reads }) => [...reads]).filter((path) => !path.endsWith('package.json')));
    expect([...read].sort()).toEqual(['packages/nodey/src/main.ts', 'packages/server/src/cli.ts']);
  });

  it('rejudges a layout another package spawns when a page beneath it decides whether the app still starts it', () => {
    const stored = new Map<string, MemoValue>();
    const base = repository();
    base.set('packages/nodey/package.json', manifest('nodey', { '.': { ssr: './src/main.ts', default: './src/main.ts' } }));
    base.set('packages/nodey/src/main.ts', "new Worker(new URL('../../../apps/web/src/routes/+layout.ts', import.meta.url));");
    base.set('apps/web/src/routes/+layout.ts', "import 'ws-lib';");
    base.set('apps/web/src/routes/child/+page.ts', 'export const prerender = true;');
    const spawned = 'apps/web/src/routes/+layout.ts [ssr] -> ws-lib';
    expect(whole(base).violations.map(({ fingerprint }) => fingerprint)).not.toContain(spawned);
    const atBase = Validity.fresh(new Dependents(10_000));
    expect(sliced(base, [''], stored, undefined, atBase).reading).toEqual(whole(base));
    const changed = new Map(base);
    changed.set('apps/web/src/routes/child/+page.ts', 'export const ssr = false;');
    expect(whole(changed).violations.map(({ fingerprint }) => fingerprint)).toContain(spawned);
    expect(
      sliced(changed, [''], stored, undefined, atBase.derive([{ path: 'apps/web/src/routes/child/+page.ts', before: 'a', after: 'b' }]))
        .reading,
    ).toEqual(whole(changed));
    expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
  });

  it('keeps the slice of a declared program outside packages when the program is deleted', () => {
    const base = repository();
    const near = snapshotOf(params, treeOf(base));
    const envelope = { files: 15, mib: 32 };
    planSlices(params, treeOf(base), [''], envelope, near);
    const changed = new Map(base);
    changed.delete('tools/run.ts');
    const derived = snapshotOf(params, treeOf(changed), { snapshot: near, changes: diff(base, changed) });
    expect(planSlices(params, treeOf(changed), [''], envelope, derived)).toEqual(planSlices(params, treeOf(changed), [''], envelope));
    expect(sliced(changed, [''], new Map()).reading).toEqual(whole(changed));
  });

  it('judges a worker two packages spawn under each spawner’s own refusals, whichever is read first', () => {
    const stored = new Map<string, MemoValue>();
    const base = repository();
    base.set('packages/nodey/src/main.ts', "import 'bun:sqlite'; new Worker(new URL('../../server/src/pool.ts', import.meta.url));");
    base.set('packages/server/src/main.ts', "new Worker(new URL('./pool.ts', import.meta.url)); export const server = 1;");
    base.set('packages/server/src/pool.ts', "import 'ws-lib';");
    const fingerprints = whole(base).violations.map(({ fingerprint }) => fingerprint);
    expect(fingerprints).toContain('packages/server/src/pool.ts [bun] -> ws-lib');
    expect(sliced(base, [''], stored).reading).toEqual(whole(base));
    const changed = new Map(base);
    changed.set('packages/server/src/main.ts', `${base.get('packages/server/src/main.ts')} export const more = 2;`);
    expect(sliced(changed, [''], stored).reading).toEqual(whole(changed));
  });

  it('reads only the edited file and the files that import it, reusing the reach of every other file of the closure', () => {
    const stored = new Map<string, MemoValue>();
    const texts = repository();
    texts.set(
      'packages/server/src/cli.ts',
      "import 'ui'; import 'nodey'; import './a'; import './d'; import './e'; new Worker(new URL('./worker.ts', import.meta.url));",
    );
    texts.set('packages/server/src/a.ts', "import './b';");
    texts.set('packages/server/src/b.ts', "import './c';");
    texts.set('packages/server/src/c.ts', 'export const c = 1;');
    texts.set('packages/server/src/d.ts', "import './c'; import 'node:os';");
    texts.set('packages/server/src/e.ts', "import 'node:os';");
    const envelope = { files: 40, mib: 32 };
    sliced(texts, [''], stored, envelope);
    texts.set('packages/server/src/c.ts', "import 'sharp';");
    const { asks, reading } = sliced(texts, [''], stored, envelope);
    expect(reading).toEqual(whole(texts));
    const read = new Set(asks.flatMap(({ reads }) => [...reads]).filter((path) => !path.endsWith('package.json')));
    expect([...read].sort()).toEqual([
      'packages/server/src/a.ts',
      'packages/server/src/b.ts',
      'packages/server/src/c.ts',
      'packages/server/src/cli.ts',
      'packages/server/src/d.ts',
    ]);
  });
});

describe('slice closure', () => {
  it('refuses a closure whose group-file work exceeds its slice limit', () => {
    const node: File = {
      edges: [],
      causes: [
        { file: 'a.ts', line: 1, specifier: 'x', group: 'x', suffix: 'x', message: 'loads `x`', fix: 'Move it.' },
        { file: 'a.ts', line: 2, specifier: 'y', group: 'y', suffix: 'y', message: 'loads `y`', fix: 'Move it.' },
      ],
      dependencies: new Map(),
      listings: new Map(),
      violations: [],
      universal: [],
    };
    let units = 0;
    expect(() =>
      reachOf(new Map([['a.ts', node]]), new Map(), (count) => {
        if ((units += count) > 2) throw new ClosureExceeded(2);
      }),
    ).toThrow(ClosureExceeded);
  });
});

describe('slice schedule', () => {
  const plan: Plan = {
    envelope: { files: 10, mib: 1 },
    headroom: 0,
    slices: [
      { parts: [{ package: 'a', judged: true }], files: 1, bytes: 1 },
      { parts: [{ package: 'b', judged: true }], files: 1, bytes: 1 },
    ],
  };
  const done: Sliced = { violations: [], universal: [], needs: [] };

  it('merges slices that need each other', () => {
    const run = schedule(plan);
    const first = run.next()!;
    run.answer(first, { ...done, needs: [{ platform: 'browser', file: 'b/x.ts', package: 'b' }] });
    const second = run.next()!;
    expect(second.slice).toBe(1);
    run.answer(second, { ...done, needs: [{ platform: 'browser', file: 'a/x.ts', package: 'a' }] });
    const merged = run.next()!;
    expect(merged.scope.parts === 'whole' ? [] : merged.scope.parts.map((part) => part.package).sort()).toEqual(['a', 'b']);
    run.answer(merged, done);
    expect(run.next()).toBeUndefined();
    expect(run.readings()).toEqual([done]);
  });

  it('splits an oversized packed group while preserving both owners and their verdicts', () => {
    const joined: Plan = { ...plan, slices: [{ parts: [...plan.slices.flatMap(({ parts }) => parts)], files: 2, bytes: 2 }] };
    const run = schedule(joined);
    run.split(run.next()!);
    const first = run.next()!;
    expect(first.scope.parts === 'whole' ? [] : first.scope.parts.map((part) => part.package)).toEqual(['a']);
    run.answer(first, { ...done, violations: [{ fingerprint: 'a', file: 'a.ts', line: 1 }] });
    const second = run.next()!;
    expect(second.scope.parts === 'whole' ? [] : second.scope.parts.map((part) => part.package)).toEqual(['b']);
    run.answer(second, { ...done, violations: [{ fingerprint: 'b', file: 'b.ts', line: 1 }] });
    expect(run.readings().flatMap(({ violations }) => violations.map(({ fingerprint }) => fingerprint))).toEqual(['a', 'b']);
  });

  it('names the indivisible cycle if an oversized split merges back', () => {
    const joined: Plan = { ...plan, slices: [{ parts: [...plan.slices.flatMap(({ parts }) => parts)], files: 2, bytes: 2 }] };
    const run = schedule(joined);
    run.split(run.next()!);
    run.answer(run.next()!, { ...done, needs: [{ platform: 'browser', file: 'b/x.ts', package: 'b' }] });
    run.answer(run.next()!, { ...done, needs: [{ platform: 'browser', file: 'a/x.ts', package: 'a' }] });
    expect(() => run.split(run.next()!)).toThrow(/indivisible package group a, b/);
  });

  it('refuses to loop when a frontier summary it produced is asked for again', () => {
    const run = schedule(plan);
    const first = run.next()!;
    const need = { platform: 'browser' as const, file: 'b/x.ts', package: 'b' };
    run.answer(first, { ...done, needs: [need] });
    run.answer(run.next()!, done);
    const again = run.next()!;
    expect(again.slice).toBe(0);
    expect(() => run.answer(again, { ...done, needs: [need] })).toThrow(/not found/);
  });
});
