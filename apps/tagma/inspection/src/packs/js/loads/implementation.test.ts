import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import type { Inspection } from '../../../builtins';
import { unbounded } from '../../../core/node/budget';
import { inspect } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { ready } from '../../../builtins.node';

await ready('loads');

const loads = (change: object = {}): Inspection => ({
  builtin: 'loads',
  params: {
    base: 'app/src',
    from: ['core/'],
    refuses: ['@acme/client', 'heavy'],
    allows: ['@acme/client/models'],
    reads: 'static',
    conditions: ['bun'],
    files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
    ...change,
  },
});

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: () => Object.keys(texts),
});

const workspace = {
  'package.json': JSON.stringify({ name: 'root', workspaces: ['packages/*', 'app'] }),
  'app/package.json': JSON.stringify({ name: 'app' }),
  'packages/client/package.json': JSON.stringify({
    name: '@acme/client',
    exports: {
      '.': { types: './src/index.ts', default: './src/index.ts' },
      './models': { bun: './src/models/index.ts', default: './src/models/missing.ts' },
      './parts/*': './src/parts/*.ts',
    },
  }),
  'packages/client/src/index.ts': "import 'heavy';\n",
  'packages/client/src/models/index.ts': "export { model } from './model';\n",
  'packages/client/src/models/model.ts': 'export const model = 1;\n',
  'packages/client/src/parts/light.ts': 'export const light = 1;\n',
};

describe('loads: reading a tree', () => {
  it('names the chain from a selected file through relative and workspace imports to the refused specifier, under file × refused entry', () => {
    const reading = inspect(
      loads(),
      tree({
        ...workspace,
        'app/src/core/model.ts': "import type { Held } from '@acme/client';\nimport { store } from './store.js';\n",
        'app/src/core/store.ts': "export { model } from '@acme/client/models';\nimport { view } from '../ui/view';\n",
        'app/src/ui/view.ts': "import { model } from '@acme/client/models';\nimport { gql } from 'heavy/graphql';\n",
      }),
      ['app/src/core/model.ts', 'app/src/core/store.ts', 'app/src/ui/view.ts'],
      unbounded(),
    );
    expect(reading).toEqual({
      violations: [
        {
          fingerprint: 'core/model.ts -> heavy',
          file: 'app/src/core/model.ts',
          line: 2,
          specifier: './store.js',
          chain: ['app/src/core/store.ts', 'app/src/ui/view.ts', 'heavy/graphql'],
          message: 'loads `heavy/graphql`',
          fix: 'Cut the chain at its first hop `./store.js`, or move the code that needs it out of what `from` selects.',
        },
        {
          fingerprint: 'core/store.ts -> heavy',
          file: 'app/src/core/store.ts',
          line: 2,
          specifier: '../ui/view',
          chain: ['app/src/ui/view.ts', 'heavy/graphql'],
          message: 'loads `heavy/graphql`',
          fix: 'Cut the chain at its first hop `../ui/view`, or move the code that needs it out of what `from` selects.',
        },
      ],
      unjudged: [],
    });
  });

  it('refuses a subpath of a refused root that no allowed entry covers, and follows the allowed one', () => {
    const texts = {
      ...workspace,
      'packages/client/src/models/model.ts': "import 'heavy';\n",
      'app/src/core/parts.ts': "import '@acme/client/parts/light';\n",
      'app/src/core/model.ts': "import '@acme/client/models';\n",
    };
    const reading = inspect(loads(), tree(texts), ['app/src/core/parts.ts', 'app/src/core/model.ts'], unbounded());
    expect(reading.violations.map(({ fingerprint, chain, fix }) => ({ fingerprint, chain, fix }))).toEqual([
      {
        fingerprint: 'core/model.ts -> heavy',
        chain: ['packages/client/src/models/index.ts', 'packages/client/src/models/model.ts', 'heavy'],
        fix: 'Cut the chain at its first hop `@acme/client/models`, or move the code that needs it out of what `from` selects.',
      },
      {
        fingerprint: 'core/parts.ts -> @acme/client',
        chain: ['@acme/client/parts/light'],
        fix: 'Load `@acme/client/models` instead of `@acme/client/parts/light`.',
      },
    ]);
  });

  it('names the shortest chain over the earliest import, through a cycle', () => {
    const reading = inspect(
      loads(),
      tree({
        ...workspace,
        'app/src/core/a.ts': "import './b';\nimport './c';\n",
        'app/src/core/b.ts': "import './a';\nimport './d';\n",
        'app/src/core/c.ts': "import 'heavy';\n",
        'app/src/core/d.ts': "import 'heavy';\n",
      }),
      ['app/src/core/a.ts'],
      unbounded(),
    );
    expect(reading.violations.map(({ line, chain }) => ({ line, chain }))).toEqual([{ line: 2, chain: ['app/src/core/c.ts', 'heavy'] }]);
  });

  it('refuses a bare specifier alone when an entry ending in /* allows every subpath under it', () => {
    const texts = { ...workspace, 'app/src/core/barrel.ts': "import 'heavy';\n", 'app/src/core/door.ts': "import 'heavy/door';\n" };
    const reading = inspect(
      loads({ allows: ['@acme/client/models', 'heavy/*'] }),
      tree(texts),
      ['app/src/core/barrel.ts', 'app/src/core/door.ts'],
      unbounded(),
    );
    expect(reading.violations.map(({ fingerprint }) => fingerprint)).toEqual(['core/barrel.ts -> heavy']);
  });

  it('follows an import() call only when the reading is runtime', () => {
    const texts = { ...workspace, 'app/src/core/lazy.ts': "export const later = () => import('heavy');\n" };
    expect(inspect(loads(), tree(texts), ['app/src/core/lazy.ts'], unbounded()).violations).toEqual([]);
    expect(
      inspect(loads({ reads: 'runtime' }), tree(texts), ['app/src/core/lazy.ts'], unbounded()).violations.map(
        ({ fingerprint }) => fingerprint,
      ),
    ).toEqual(['core/lazy.ts -> heavy']);
  });

  it('follows aliases from a generated config through its tracked copy', () => {
    const reading = inspect(
      loads({
        base: 'app',
        from: ['src/core/'],
        built: [{ output: '.svelte-kit/tsconfig.json', source: 'kit.tsconfig.json', why: 'The tracked generated config.' }],
      }),
      tree({
        ...workspace,
        'app/tsconfig.json': JSON.stringify({ extends: './.svelte-kit/tsconfig.json' }),
        'app/kit.tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '$lib/*': ['../src/lib/*'] } } }),
        'app/src/core/page.ts': "import '$lib/store';\n",
        'app/src/lib/store.ts': "import 'heavy';\n",
      }),
      ['app/src/core/page.ts'],
      unbounded(),
    );
    expect(reading.violations.map(({ fingerprint, chain }) => ({ fingerprint, chain }))).toEqual([
      { fingerprint: 'src/core/page.ts -> heavy', chain: ['app/src/lib/store.ts', 'heavy'] },
    ]);
    expect(reading.unjudged).toEqual([]);
  });

  it('names what resolves to no listed file as unjudged, and enters no package outside the workspace', () => {
    const reading = inspect(
      loads(),
      tree({
        ...workspace,
        'app/src/core/model.ts': "import '@acme/client/models/nowhere';\nimport './gone';\nimport '#internal';\nimport 'lodash';\n",
      }),
      ['app/src/core/model.ts'],
      unbounded(),
    );
    expect(reading).toEqual({
      violations: [],
      unjudged: [
        { file: 'app/src/core/model.ts', line: 1, specifier: '@acme/client/models/nowhere' },
        { file: 'app/src/core/model.ts', line: 2, specifier: './gone' },
        { file: 'app/src/core/model.ts', line: 3, specifier: '#internal' },
      ],
    });
  });
});

describe('judge: loads', () => {
  const standing = {
    ...workspace,
    'app/src/core/store.ts': "import 'heavy';\n",
    'app/src/core/model.ts': "import { store } from './store';\n",
  };

  it('does not count a changed file whose load of a refused specifier stood on the base side', () => {
    const verdict = judge(
      loads(),
      {
        base: tree(standing),
        built: tree({ ...standing, 'app/src/core/model.ts': "export const model = 1;\nimport { store } from './store';\n" }),
        paths: ['app/src/core/model.ts'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations).toEqual([]);
  });

  it('answers a changed file that newly reaches a refused specifier through a file it did not change', () => {
    const verdict = judge(
      loads(),
      {
        base: tree({ ...standing, 'app/src/core/view.ts': 'export const view = 1;\n' }),
        built: tree({ ...standing, 'app/src/core/view.ts': "import { store } from './store';\n" }),
        paths: ['app/src/core/view.ts'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations.map(({ fingerprint, line, chain }) => ({ fingerprint, line, chain }))).toEqual([
      { fingerprint: 'core/view.ts -> heavy', line: 1, chain: ['app/src/core/store.ts', 'heavy'] },
    ]);
  });
});
