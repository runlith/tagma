import { describe, expect, it } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import { type Inspection, type Params } from '../../../builtins';
import { ready } from '../../../builtins.node';
import { unbounded } from '../../../core/node/budget';
import { inspect } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';

await ready('size');

type SizeParams = Params<'size'>;

const params = (thresholds: SizeParams['thresholds'], more: Partial<SizeParams> = {}): SizeParams => ({
  base: 'src',
  files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  thresholds,
  ...more,
});

const size = (value: SizeParams): Inspection => ({ builtin: 'size', params: value });

const tree = (texts: Record<string, string>): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: () => Object.keys(texts),
});

const body = (count: number, name = 'v'): string =>
  Array.from({ length: count }, (_, at) => `export const ${name}${at} = ${at};`).join('\n');

const four = params([{ glob: '**', metric: 'non-import', lines: 4 }]);

const fresh = (
  value: SizeParams,
  base: Record<string, string>,
  built: Record<string, string>,
  debt: readonly { fingerprint: string }[] = [],
) =>
  judge(
    size(value),
    {
      base: tree(base),
      built: tree(built),
      paths: [...new Set([...Object.keys(base), ...Object.keys(built)])].filter((path) => base[path] !== built[path]),
    },
    debt,
    unbounded(),
  );

describe('size: reading', () => {
  it('reports each file over its threshold at its non-import lines, keyed by the file', () => {
    const texts = {
      'src/a/big.ts': `import { x } from './x';\n${body(5)}`,
      'src/a/edge.ts': body(4),
      'src/small.ts': body(1),
      'src/skipped.test.ts': body(9),
    };
    const { violations, unjudged } = inspect(size(four), tree(texts), Object.keys(texts), unbounded());
    expect(violations.map(({ fingerprint, value }) => [fingerprint, value])).toEqual([['a/big.ts', 5]]);
    expect(unjudged).toEqual([]);
  });

  it('holds a file to the lowest threshold of the globs it matches and judges only files a glob matches', () => {
    const value = params([
      { glob: '**', metric: 'non-import', lines: 6 },
      { glob: 'strict/**', metric: 'non-import', lines: 2 },
    ]);
    const texts = { 'src/strict/a.ts': body(3), 'src/loose/b.ts': body(5), 'src/loose/c.ts': body(7) };
    expect(
      inspect(size(value), tree(texts), Object.keys(texts), unbounded()).violations.map(({ fingerprint, value: measured }) => [
        fingerprint,
        measured,
      ]),
    ).toEqual([
      ['loose/c.ts', 7],
      ['strict/a.ts', 3],
    ]);
    expect(
      inspect(size(value), tree(texts), ['src/strict/a.ts'], unbounded()).violations.map(({ message, fix }) => ({ message, fix })),
    ).toEqual([
      {
        message: 'holds 3 lines outside its imports, over 2',
        fix: 'Move the code of another subject to the file that owns it until this one holds at most the 2 lines `strict/**` allows; split by named subjects, never by the count.',
      },
    ]);
    const narrow = params([{ glob: 'strict/**', metric: 'non-import', lines: 2 }]);
    expect(inspect(size(narrow), tree(texts), Object.keys(texts), unbounded()).violations.map(({ fingerprint }) => fingerprint)).toEqual([
      'strict/a.ts',
    ]);
  });

  it('names a file no adapter reads as unjudged, never as zero lines', () => {
    const texts = { 'src/a.ts': body(20) };
    const { violations, unjudged } = inspect(size(four), tree(texts), Object.keys(texts), unbounded(), []);
    expect(violations).toEqual([]);
    expect(unjudged.map(({ file }) => file)).toEqual(['src/a.ts']);
  });

  it('fails the reading for a file its adapter reads and cannot parse, never dropping its violation', () => {
    const texts = { 'src/big.ts': `${body(9)}\nexport const = ;` };
    expect(() => inspect(size(four), tree(texts), Object.keys(texts), unbounded())).toThrow('does not parse');
    expect(() => fresh(four, { 'src/big.ts': body(9) }, texts, [{ fingerprint: 'big.ts' }])).toThrow('does not parse');
  });
});

describe('size: debt', () => {
  const debt = [{ fingerprint: 'big.ts' }];
  const base = { 'src/big.ts': body(6) };

  it('lets a file in debt stand, shrink or grow, and refuses a file that is new', () => {
    expect(fresh(four, base, { 'src/big.ts': body(6, 'w') }, debt).violations).toEqual([]);
    expect(fresh(four, base, { 'src/big.ts': body(5) }, debt).violations).toEqual([]);
    expect(fresh(four, base, { 'src/big.ts': body(9) }, debt).violations).toEqual([]);
    expect(fresh(four, base, { ...base, 'src/other.ts': body(5) }, debt).violations.map(({ fingerprint }) => fingerprint)).toEqual([
      'other.ts',
    ]);
  });

  it('carries a file in debt to its new path when it moves, grown or not', () => {
    const moved = fresh(four, base, { 'src/sub/big.ts': `${base['src/big.ts']}\n\n\n` }, debt);
    expect(moved.violations).toEqual([]);
    expect(moved.followed).toEqual([{ from: 'big.ts', to: 'sub/big.ts' }]);
  });
});
