import { describe, expect, it } from 'bun:test';
import { fileEdges, importEdges, type Tree, type Unresolved } from '../../tree';
import { UnsupportedSource } from '../../imports';
import { js } from '../adapters';
import { workspaceOf } from './workspace';

const texts = new Map([
  [
    'src/entry.ts',
    ["import { b } from './compiled.js';", "import { c } from './both';", "import { d } from './folder';", "import './gone';", ''].join(
      '\n',
    ),
  ],
  ['src/compiled.ts', ''],
  ['src/both.ts', ''],
  ['src/both/index.ts', ''],
  ['src/folder/index.ts', ''],
]);
const tree: Tree = {
  has: (path) => texts.has(path),
  read: (path) => texts.get(path) ?? '',
};

const GONE = ['src/gone', 'src/gone.ts', 'src/gone.tsx', 'src/gone/index.ts'];

const targets = (rows: readonly Unresolved[]) => rows.map(({ absent: _absent, ...one }) => one);

describe('fileEdges', () => {
  it('reports the absent probes before each hit, and every candidate on a miss', () => {
    const probed = fileEdges(tree, 'src/entry.ts', 'every', [js], null);
    expect(probed.edges).toEqual([
      { file: 'src/entry.ts', line: 1, specifier: './compiled.js', to: 'src/compiled.ts' },
      { file: 'src/entry.ts', line: 2, specifier: './both', to: 'src/both.ts' },
      { file: 'src/entry.ts', line: 3, specifier: './folder', to: 'src/folder/index.ts' },
    ]);
    expect(probed.unresolved).toEqual([{ file: 'src/entry.ts', line: 4, specifier: './gone', unlisted: 'src/gone', absent: GONE }]);
    expect(probed.absent).toEqual([
      'src/compiled.js',
      'src/both',
      'src/folder',
      'src/folder.ts',
      'src/folder.tsx',
      'src/gone',
      'src/gone.ts',
      'src/gone.tsx',
      'src/gone/index.ts',
    ]);
    expect(probed.packages).toEqual([]);
  });

  it('names the shadowed candidate, so adding it re-resolves the importer', () => {
    const shadowed = new Map([
      ['src/entry.ts', "import { x } from './x';\n"],
      ['src/x/index.ts', ''],
    ]);
    const shadowTree: Tree = { has: (path) => shadowed.has(path), read: (path) => shadowed.get(path) ?? '' };
    const before = fileEdges(shadowTree, 'src/entry.ts', 'every', [js], null);
    expect(before.edges).toEqual([{ file: 'src/entry.ts', line: 1, specifier: './x', to: 'src/x/index.ts' }]);
    expect(before.absent).toContain('src/x.ts');
    shadowed.set('src/x.ts', '');
    const after = fileEdges(shadowTree, 'src/entry.ts', 'every', [js], null);
    expect(after.edges).toEqual([{ file: 'src/entry.ts', line: 1, specifier: './x', to: 'src/x.ts' }]);
  });

  it('hands bare package names to the workspace, hit or miss, with the door probes', () => {
    const workspace = new Map([
      ['package.json', JSON.stringify({ workspaces: ['libs/*'], dependencies: { lodash: '*' } })],
      ['app/entry.ts', "import { a } from '@acme/kit';\nimport { b } from '@acme/kit/gone';\nimport { c } from 'lodash';\n"],
      ['libs/kit/package.json', JSON.stringify({ name: '@acme/kit', exports: { '.': './src/index.ts', './gone': './src/gone.ts' } })],
      ['libs/kit/src/index.ts', ''],
    ]);
    const listed: Tree = { has: (path) => workspace.has(path), read: (path) => workspace.get(path) ?? '', paths: () => workspace.keys() };
    const probed = fileEdges(listed, 'app/entry.ts', 'every', [js], workspaceOf(listed, 'app', []));
    expect(probed.edges).toEqual([{ file: 'app/entry.ts', line: 1, specifier: '@acme/kit', to: 'libs/kit/src/index.ts' }]);
    expect(probed.unresolved).toEqual([
      { file: 'app/entry.ts', line: 2, specifier: '@acme/kit/gone', unlisted: 'libs/kit/src/gone.ts', absent: ['libs/kit/src/gone.ts'] },
    ]);
    expect(probed.packages).toEqual(['@acme/kit', 'lodash']);
    expect(probed.absent).toEqual(['libs/kit/src/gone.ts']);
  });

  it('builds the workspace only when a specifier the relative rules leave alone appears', () => {
    let built = 0;
    const lazy = (): ReturnType<typeof workspaceOf> => {
      built++;
      return workspaceOf(tree, 'src', []);
    };
    fileEdges(tree, 'src/entry.ts', 'every', [js], lazy);
    expect(built).toBe(0);
    const workspace = new Map([
      ['package.json', JSON.stringify({ workspaces: ['libs/*'] })],
      ['src/uses.ts', "import { a } from 'pkg';\n"],
    ]);
    const listed: Tree = { has: (path) => workspace.has(path), read: (path) => workspace.get(path) ?? '', paths: () => workspace.keys() };
    fileEdges(listed, 'src/uses.ts', 'every', [js], () => {
      built++;
      return workspaceOf(listed, 'src', []);
    });
    expect(built).toBe(1);
  });

  it('resolves inherited paths and baseUrl in each importer config, and reports a missing alias', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ workspaces: ['apps/*', 'configs/*'] })],
      ['configs/base/package.json', JSON.stringify({ name: '@cfg/base' })],
      ['configs/base/options.json', '{ "compilerOptions": { "baseUrl": "../..", "paths": { "@shared/*": ["missing/*", "shared/*"] } } }'],
      ['tsconfig.base.json', '{ "extends": "@cfg/base/options.json" }'],
      ['apps/a/tsconfig.json', '{ "extends": "../../tsconfig.base.json" }'],
      ['apps/b/tsconfig.json', '{ "compilerOptions": { "baseUrl": "./local" } }'],
      ['apps/a/main.ts', "import '@shared/value';\nimport 'shared/value';\nimport '@shared/gone';"],
      ['apps/b/main.ts', "import 'shared/value';"],
      ['shared/value.ts', ''],
      ['apps/b/local/shared/value.ts', ''],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    const result = importEdges(listed, ['apps/a/main.ts', 'apps/b/main.ts'], 'every', [js], { from: '', context: { conditions: [] } });
    expect(result.edges).toEqual([
      { file: 'apps/a/main.ts', line: 1, specifier: '@shared/value', to: 'shared/value.ts' },
      { file: 'apps/a/main.ts', line: 2, specifier: 'shared/value', to: 'shared/value.ts' },
      { file: 'apps/b/main.ts', line: 1, specifier: 'shared/value', to: 'apps/b/local/shared/value.ts' },
    ]);
    expect(targets(result.unresolved)).toEqual([{ file: 'apps/a/main.ts', line: 3, specifier: '@shared/gone', unlisted: 'missing/gone' }]);
    files.set('apps/a/tsconfig.json', '{ "compilerOptions": { "paths": 42 } }');
    expect(() => importEdges(listed, ['apps/a/main.ts'], 'every', [js], { from: '', context: { conditions: [] } })).toThrow(
      UnsupportedSource,
    );
  });

  it('lands an alias on the file its target names exactly before probing extensions after it, unless it names compiled output', () => {
    const files = new Map([
      ['tsconfig.json', '{ "compilerOptions": { "paths": { "$lib/*": ["src/lib/*", "other/*"] } } }'],
      ['app/main.ts', "import '$lib/Panel.svelte';\nimport '$lib/state.js';\nimport '$lib/later';"],
      ['src/lib/Panel.svelte', ''],
      ['src/lib/Panel.svelte.ts', ''],
      ['src/lib/state.js', ''],
      ['src/lib/state.ts', ''],
      ['src/lib/later.ts', ''],
      ['other/later', ''],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    expect(importEdges(listed, ['app/main.ts'], 'every', [js], { from: '', context: { conditions: [] } }).edges).toEqual([
      { file: 'app/main.ts', line: 1, specifier: '$lib/Panel.svelte', to: 'src/lib/Panel.svelte' },
      { file: 'app/main.ts', line: 2, specifier: '$lib/state.js', to: 'src/lib/state.ts' },
      { file: 'app/main.ts', line: 3, specifier: '$lib/later', to: 'src/lib/later.ts' },
    ]);
  });

  it('names as absent exactly the probes an unresolved alias would land on if each were added alone', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ workspaces: ['configs/*'] })],
      ['configs/base/package.json', JSON.stringify({ name: '@cfg/base' })],
      ['tsconfig.json', '{ "compilerOptions": { "paths": { "@shared/*": ["missing/*", "shared/*"] } } }'],
      ['apps/a/main.ts', "import '@shared/gone';"],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    const asked = { from: '', context: { conditions: [] } };
    const [miss] = importEdges(listed, ['apps/a/main.ts'], 'every', [js], asked).unresolved;
    const probes = workspaceOf(listed, '', []).traced('@shared/gone', 'apps/a/main.ts').absent;
    const landing = probes.filter((probe) => {
      const added: Tree = { ...listed, has: (path) => path === probe || listed.has(path) };
      return importEdges(added, ['apps/a/main.ts'], 'every', [js], asked).edges.some((edge) => edge.to === probe);
    });
    expect(landing.length).toBeGreaterThan(0);
    expect(landing.length).toBeLessThan(probes.length);
    expect(miss?.absent).toEqual(landing);
  });

  it('resolves package imports in their own scope with ordered conditions, patterns and package targets', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ workspaces: ['libs/*'] })],
      [
        'libs/a/package.json',
        JSON.stringify({
          name: 'a',
          imports: {
            '#entry': { default: './src/default.ts', bun: './src/bun.ts' },
            '#parts/*': './src/*.ts',
            '#package': 'b',
            '#external': ['vendor'],
            '#blocked': null,
            '#cycle': '#cycle',
          },
          dependencies: { vendor: '*' },
        }),
      ],
      [
        'libs/a/main.ts',
        "import '#entry';\nimport '#parts/value';\nimport '#package';\nimport '#external';\nimport '#blocked';\nimport '#cycle';\nimport '#parts/gone';",
      ],
      ['libs/a/src/default.ts', ''],
      ['libs/a/src/bun.ts', ''],
      ['libs/a/src/value.ts', ''],
      ['libs/b/package.json', JSON.stringify({ name: 'b', exports: './main.ts', imports: { '#entry': './main.ts' } })],
      ['libs/b/main.ts', "import '#entry';\nimport '#unknown';"],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    const result = importEdges(listed, ['libs/a/main.ts', 'libs/b/main.ts'], 'every', [js], { from: '', context: { conditions: ['bun'] } });
    expect(result.edges).toEqual([
      { file: 'libs/a/main.ts', line: 1, specifier: '#entry', to: 'libs/a/src/default.ts' },
      { file: 'libs/a/main.ts', line: 2, specifier: '#parts/value', to: 'libs/a/src/value.ts' },
      { file: 'libs/a/main.ts', line: 3, specifier: '#package', to: 'libs/b/main.ts' },
      { file: 'libs/b/main.ts', line: 1, specifier: '#entry', to: 'libs/b/main.ts' },
    ]);
    expect(result.unresolved).toEqual([
      { file: 'libs/a/main.ts', line: 5, specifier: '#blocked', unlisted: 'libs/a', absent: [] },
      { file: 'libs/a/main.ts', line: 6, specifier: '#cycle', unlisted: 'libs/a', absent: [] },
      {
        file: 'libs/a/main.ts',
        line: 7,
        specifier: '#parts/gone',
        unlisted: 'libs/a/src/gone.ts',
        absent: ['libs/a/src/gone.ts', 'libs/a/src/gone.ts.ts', 'libs/a/src/gone.ts.tsx', 'libs/a/src/gone.ts/index.ts'],
      },
      { file: 'libs/b/main.ts', line: 2, specifier: '#unknown', unlisted: 'libs/b', absent: [] },
    ]);
  });

  it('keeps builtins and declared externals external and names undeclared bare imports in the importer scope without a workspace', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ dependencies: { rootOnly: '*' } })],
      [
        'app/package.json',
        JSON.stringify({
          dependencies: { '@vendor/tool': '*' },
          peerDependencies: { peer: '*' },
          optionalDependencies: { optional: '*' },
          devDependencies: { dev: '*' },
        }),
      ],
      ['app/tsconfig.json', JSON.stringify({ compilerOptions: { paths: { '*': ['./missing/*'] } } })],
      [
        'app/main.ts',
        "import '@vendor/tool/part';\nimport 'peer';\nimport 'optional';\nimport 'dev';\nimport 'node:fs';\nimport 'path';\nimport 'bun:test';\nimport 'unknown/subpath';\nimport 'rootOnly';",
      ],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    const result = importEdges(listed, ['app/main.ts'], 'every', [js], {
      from: '',
      context: { conditions: [], runtimes: ['node', 'bun'] },
    });
    expect(result.dynamic).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(targets(result.unresolved)).toEqual([
      { file: 'app/main.ts', line: 8, specifier: 'unknown/subpath', unlisted: 'app/missing/unknown/subpath' },
      { file: 'app/main.ts', line: 9, specifier: 'rootOnly', unlisted: 'app/missing/rootOnly' },
    ]);
  });

  it('leaves package exports to the caller conditions when paths do not resolve the specifier', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ workspaces: ['libs/*'] })],
      ['libs/a/package.json', JSON.stringify({ name: 'a', exports: { types: './types.d.ts', bun: './runtime.ts' } })],
      ['libs/a/main.ts', "import 'a';"],
      ['libs/a/types.d.ts', ''],
      ['libs/a/runtime.ts', ''],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    for (const paths of [{ '@other/*': ['other/*'] }, { '*': ['missing/*'] }]) {
      files.set('libs/a/tsconfig.json', JSON.stringify({ compilerOptions: { paths } }));
      expect(importEdges(listed, ['libs/a/main.ts'], 'every', [js], { from: '', context: { conditions: ['bun'] } })).toEqual({
        dynamic: [],
        edges: [{ file: 'libs/a/main.ts', line: 1, specifier: 'a', to: 'libs/a/runtime.ts' }],
        unresolved: [],
      });
    }
  });

  it('keeps the built-ins of a declared runtime external even when paths and baseUrl offer local files, and only those', () => {
    const files = new Map([
      ['package.json', '{}'],
      ['tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { 'node:fs': ['./fs.ts'] } } })],
      ['src/main.ts', "import 'path';\nimport 'node:fs';"],
      ['src/path.ts', ''],
      ['src/fs.ts', ''],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    const edges = (runtimes: readonly string[]) =>
      importEdges(listed, ['src/main.ts'], 'every', [js], { from: '', context: { conditions: ['bun'], runtimes } }).edges.map(
        ({ specifier, to }) => `${specifier} -> ${to}`,
      );
    expect(edges(['node'])).toEqual([]);
    expect(edges([])).toEqual(['path -> src/path.ts', 'node:fs -> src/fs.ts']);
  });

  it('skips inadmissible imports array targets and selects the first admissible fallback', () => {
    const files = new Map([
      ['package.json', JSON.stringify({ imports: { '#entry': ['../outside.ts', './src/entry.ts'] } })],
      ['src/main.ts', "import '#entry';"],
      ['src/entry.ts', ''],
    ]);
    const listed: Tree = { has: (path) => files.has(path), read: (path) => files.get(path) ?? '', paths: () => files.keys() };
    expect(importEdges(listed, ['src/main.ts'], 'every', [js], { from: '', context: { conditions: [] } })).toEqual({
      dynamic: [],
      edges: [{ file: 'src/main.ts', line: 1, specifier: '#entry', to: 'src/entry.ts' }],
      unresolved: [],
    });
  });

  it('importEdges still answers edges and unresolved for old callers', () => {
    expect(importEdges(tree, ['src/entry.ts'], 'every', [js])).toEqual({
      dynamic: [],
      edges: [
        { file: 'src/entry.ts', line: 1, specifier: './compiled.js', to: 'src/compiled.ts' },
        { file: 'src/entry.ts', line: 2, specifier: './both', to: 'src/both.ts' },
        { file: 'src/entry.ts', line: 3, specifier: './folder', to: 'src/folder/index.ts' },
      ],
      unresolved: [{ file: 'src/entry.ts', line: 4, specifier: './gone', unlisted: 'src/gone', absent: GONE }],
    });
  });
});
