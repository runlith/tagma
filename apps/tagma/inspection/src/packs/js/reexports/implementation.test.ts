import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import type { Inspection } from '../../../builtins';
import { unbounded } from '../../../core/node/budget';
import { inspect } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { ready } from '../../../builtins.node';

await ready('reexports');

const reexports: Inspection = {
  builtin: 'reexports',
  params: {
    base: 'pkg/src',
    allows: ['entry.ts'],
    files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  },
};

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
});

const defined = { 'pkg/src/a.ts': 'export const a = 1;\n', 'pkg/src/b.ts': 'export const b = 1;\n' };

describe('reexports: reading a tree', () => {
  it('answers each forwarded specifier of a selected file under file and specifier, and leaves an allowed, excluded or outside file and an own export alone', () => {
    const texts = {
      ...defined,
      'pkg/src/index.ts': "export * from './a';\nexport { b } from './b';\n",
      'pkg/src/view.ts': "import { a } from './a';\nexport { a };\n",
      'pkg/src/own.ts': "import { a } from './a';\nexport const twice = a * 2;\n",
      'pkg/src/entry.ts': "export * from './a';\n",
      'pkg/src/index.test.ts': "export * from './a';\n",
      'other/index.ts': "export * from './x';\n",
    };
    expect(inspect(reexports, tree(texts), Object.keys(texts), unbounded())).toEqual({
      violations: [
        {
          fingerprint: 'index.ts -> ./a',
          file: 'pkg/src/index.ts',
          line: 1,
          specifier: './a',
          message: 're-exports `./a`',
          fix: 'Import what it forwards from `./a` directly where it is used, and delete the forwarding here.',
        },
        {
          fingerprint: 'index.ts -> ./b',
          file: 'pkg/src/index.ts',
          line: 2,
          specifier: './b',
          message: 're-exports `./b`',
          fix: 'Import what it forwards from `./b` directly where it is used, and delete the forwarding here.',
        },
        {
          fingerprint: 'view.ts -> ./a',
          file: 'pkg/src/view.ts',
          line: 1,
          specifier: './a',
          message: 're-exports `./a`',
          fix: 'Import what it forwards from `./a` directly where it is used, and delete the forwarding here.',
        },
      ],
      unjudged: [],
    });
  });
});

describe('judge: reexports', () => {
  it('does not count a changed file keeping its base-side forward, and counts one it newly forwards', () => {
    const base = { ...defined, 'pkg/src/index.ts': "export * from './a';\n" };
    const verdict = judge(
      reexports,
      {
        base: tree(base),
        built: tree({ ...base, 'pkg/src/index.ts': "export const own = 1;\nexport * from './a';\nexport { b } from './b';\n" }),
        paths: ['pkg/src/index.ts'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations.map(({ fingerprint, line }) => ({ fingerprint, line }))).toEqual([
      { fingerprint: 'index.ts -> ./b', line: 3 },
    ]);
  });
});
