import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import { Schema } from 'effect';
import { type Assembled, BUILTINS, assembled } from './builtins';
import { ready } from './builtins.node';
import type { ModuleMap } from './core/rule';
import { inspect } from './core/node/implementations';

await ready('modules');
await ready('size');

type Project = { readonly relations: ModuleMap['relations']; readonly size: unknown; readonly files: Readonly<Record<string, string>> };

const law = {
  base: 'src',
  cycles: 'refuse',
  coverage: 'refuse',
  unresolved: 'refuse',
  reads: 'every',
  files: { extensions: ['.ts'], exclude: [] },
};
const territories = [
  { id: 'kernel', territory: ['src/kernel/'] },
  { id: 'a', territory: ['src/parts/a/'] },
  { id: 'b', territory: ['src/parts/b/'] },
] as const;
const ceiling = (lines: number) => ({
  base: 'src',
  files: { extensions: ['.ts'], exclude: [] },
  thresholds: [{ glob: '**', metric: 'non-import', lines }],
});

const orchard: Project = {
  relations: [
    { from: 'a', to: 'kernel' },
    { from: 'b', to: 'kernel' },
  ],
  size: ceiling(40),
  files: {
    'src/kernel/money.ts': 'export const cents = 100;\nexport const round = (n: number) => Math.round(n);\nexport const zero = 0;\n',
    'src/parts/a/cart.ts': "import { cents } from '../../kernel/money';\nexport const total = cents;\n",
    'src/parts/b/pay.ts': "import { round } from '../../kernel/money';\nexport const pay = round(1);\n",
  },
};

const tidepool: Project = {
  relations: [
    { from: 'b', to: 'a' },
    { from: 'kernel', to: 'a' },
    { from: 'kernel', to: 'b' },
  ],
  size: ceiling(2),
  files: {
    'src/parts/a/body.ts': 'export const mass = 1;\n',
    'src/parts/b/draw.ts': "import { mass } from '../a/body';\nexport const draw = mass;\n",
    'src/kernel/loop.ts':
      "import { mass } from '../parts/a/body';\nimport { draw } from '../parts/b/draw';\nexport const tick = mass + draw;\n",
  },
};

const tree = (files: Readonly<Record<string, string>>): Tree => ({
  has: (path) => Object.hasOwn(files, path),
  read: (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: () => Object.keys(files),
});

const policies = (project: Project): readonly Assembled[] => [
  assembled(
    { builtin: 'modules', params: Schema.decodeUnknownSync(BUILTINS.modules.params)(law) },
    { modules: territories, relations: project.relations, region: ['src/'] },
  ),
  { builtin: 'size', params: Schema.decodeUnknownSync(BUILTINS.size.params)(project.size) },
];

const judged = (policy: Project, code: Project): readonly string[] =>
  policies(policy)
    .flatMap((inspection) =>
      inspect(inspection, tree(code.files), Object.keys(code.files)).violations.map(
        ({ fingerprint }) => `${inspection.builtin} ${fingerprint}`,
      ),
    )
    .sort();

describe('two unrelated projects with contradicting policies', () => {
  it('judge each tree by its own policy and module map as data, with one catalog and no code of theirs', () => {
    expect(judged(orchard, orchard)).toEqual([]);
    expect(judged(tidepool, tidepool)).toEqual([]);
    expect(judged(orchard, tidepool)).toEqual([
      'modules b -> a @ parts/b/draw.ts',
      'modules kernel -> a @ kernel/loop.ts',
      'modules kernel -> b @ kernel/loop.ts',
    ]);
    expect(judged(tidepool, orchard)).toEqual([
      'modules a -> kernel @ parts/a/cart.ts',
      'modules b -> kernel @ parts/b/pay.ts',
      'size kernel/money.ts',
    ]);
  });
});
