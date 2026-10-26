import { describe, expect, it } from 'bun:test';
import { importEdges, type Tree } from '../../tree';
import { js } from '../adapters';
import { resolveUnique } from './resolve';

const texts = new Map([
  [
    'src/entry.ts',
    [
      "import { b } from './compiled.js';",
      "import { c } from './both';",
      "import { d } from './folder';",
      "import './gone';",
      "import { x } from 'pkg';",
      "export type Out = import('../../outside').Out;",
      '',
    ].join('\n'),
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

describe('JS resolution over a tree', () => {
  it('refuses ambiguous extension and directory candidates and probes absent shadow paths', () => {
    const probed = new Set<string>();
    const measured: Tree = {
      ...tree,
      has: (path) => {
        probed.add(path);
        return tree.has(path);
      },
    };
    expect(resolveUnique('./both', 'src/entry.ts', measured)).toMatchObject({ candidates: ['src/both.ts', 'src/both/index.ts'] });
    expect(resolveUnique('./folder', 'src/entry.ts', measured)).toEqual({ to: 'src/folder/index.ts' });
    expect(
      resolveUnique('./Sidebar.svelte', 'src/entry.ts', {
        has: (path) => ['src/Sidebar.svelte', 'src/Sidebar.svelte.ts'].includes(path),
        read: () => '',
      }),
    ).toEqual({ to: 'src/Sidebar.svelte' });
    expect(probed.has('src/folder.ts')).toBe(true);
    expect(probed.has('src/folder.js')).toBe(true);
  });
  it('resolves relative specifiers over the listing in the runtime order, and names what lands on no path with the path it names', () => {
    expect(importEdges(tree, ['src/entry.ts'], 'every', [js])).toEqual({
      dynamic: [],
      edges: [
        { file: 'src/entry.ts', line: 1, specifier: './compiled.js', to: 'src/compiled.ts' },
        { file: 'src/entry.ts', line: 2, specifier: './both', to: 'src/both.ts' },
        { file: 'src/entry.ts', line: 3, specifier: './folder', to: 'src/folder/index.ts' },
      ],
      unresolved: [
        {
          file: 'src/entry.ts',
          line: 4,
          specifier: './gone',
          unlisted: 'src/gone',
          absent: ['src/gone', 'src/gone.ts', 'src/gone.tsx', 'src/gone/index.ts'],
        },
        {
          file: 'src/entry.ts',
          line: 6,
          specifier: '../../outside',
          unlisted: '../outside',
          absent: ['../outside', '../outside.ts', '../outside.tsx', '../outside/index.ts'],
        },
      ],
    });
  });

  it('resolves a workspace specifier through its exports only when packages are asked for, and names a door that lands on no file', () => {
    const workspace = new Map([
      ['package.json', JSON.stringify({ workspaces: ['libs/*'], dependencies: { lodash: '*' } })],
      ['app/entry.ts', "import { a } from '@acme/kit';\nimport { b } from '@acme/kit/gone';\nimport { c } from 'lodash';\n"],
      ['libs/kit/package.json', JSON.stringify({ name: '@acme/kit', exports: { '.': './src/index.ts', './gone': './src/gone.ts' } })],
      ['libs/kit/src/index.ts', ''],
    ]);
    const listed: Tree = { has: (path) => workspace.has(path), read: (path) => workspace.get(path) ?? '', paths: () => workspace.keys() };
    expect(importEdges(listed, ['app/entry.ts'], 'every', [js])).toEqual({ dynamic: [], edges: [], unresolved: [] });
    expect(importEdges(listed, ['app/entry.ts'], 'every', [js], { from: 'app', context: { conditions: [] } })).toEqual({
      dynamic: [],
      edges: [{ file: 'app/entry.ts', line: 1, specifier: '@acme/kit', to: 'libs/kit/src/index.ts' }],
      unresolved: [
        { file: 'app/entry.ts', line: 2, specifier: '@acme/kit/gone', unlisted: 'libs/kit/src/gone.ts', absent: ['libs/kit/src/gone.ts'] },
      ],
    });
  });
});
