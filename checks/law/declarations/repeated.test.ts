import { expect, test } from 'bun:test';
import type { RepeatedParams } from './declaration';
import { findRepeated } from './repeated';
import { corpusOf } from './sources';

const params: RepeatedParams = {
  region: ['src/'],
  tests: ['**/*.test.ts', '**/testing/**'],
  scope: 'exported',
  minMembers: 3,
  minUnion: 3,
  minLiterals: 3,
  ignoreNames: [],
  aliases: [{ prefix: '$lib/', dir: 'src/lib' }],
};

const judge = (sources: Record<string, string>, over: Partial<RepeatedParams> = {}) => {
  const merged = { ...params, ...over };
  return findRepeated(corpusOf(sources, merged), merged).map((one) => [one.path, one.line, one.fingerprint.split(' ')[1]!.split(':')[0]]);
};

test('object types equal in member names, optionality and types repeat across files whatever their order, names and syntax', () => {
  const found = findRepeated(
    corpusOf(
      {
        'src/a.ts': 'export type Pick = {\n  readonly id: string;\n  readonly title?: string;\n  readonly tags: readonly string[];\n};\n',
        'src/b.ts':
          'export interface Draft {\n  readonly tags: readonly string[];\n  readonly title?: string;\n  readonly id: string;\n}\n',
        'src/c.ts': 'export type Other = { readonly id: string; readonly title: string; readonly tags: readonly string[] };\n',
      },
      params,
    ),
    params,
  );
  expect(found.map((one) => [one.path, one.line])).toEqual([
    ['src/a.ts', 1],
    ['src/b.ts', 1],
  ]);
  expect(found[0]?.message).toBe('object type `Pick` {id, title, tags} is also declared in src/b.ts:1 (`Draft`)');
});

test('a type below the member minimum, a same-file copy, a test-file copy and an unexported copy are not repeats', () => {
  const small = 'export type Pair = { readonly a: string; readonly b: string };\n';
  const wide = 'export type Wide = { readonly a: string; readonly b: string; readonly c: number };\n';
  expect(
    judge({
      'src/one.ts': `${small}${wide}export type Wide2 = { readonly a: string; readonly b: string; readonly c: number };\n`,
      'src/two.ts': small,
      'src/three.test.ts': wide,
      'src/testing/fake.ts': wide,
      'src/four.ts':
        'type Hidden = { readonly a: string; readonly b: string; readonly c: number };\nexport const hidden: Hidden | undefined = undefined;\n',
    }),
  ).toEqual([]);
  expect(
    judge(
      {
        'src/one.ts': wide,
        'src/four.ts':
          'type Hidden = { readonly a: string; readonly b: string; readonly c: number };\nexport const hidden: Hidden | undefined = undefined;\n',
      },
      { scope: 'all' },
    ),
  ).toEqual([
    ['src/four.ts', 1, 'object'],
    ['src/one.ts', 1, 'object'],
  ]);
});

test('readonly, optional, type, generic or heritage differences make object types different', () => {
  expect(
    judge({
      'src/a.ts': 'export type Shape = { readonly id: string; name: string; readonly size: number };\n',
      'src/b.ts': 'export type Shape = { readonly id: string; readonly name: string; readonly size: number };\n',
      'src/c.ts': 'export type Shape = { readonly id: string; name?: string; readonly size: number };\n',
      'src/d.ts': 'export type Shape = { readonly id: string; name: string; readonly size: bigint };\n',
      'src/e.ts': 'export interface Row<T> { readonly id: T; readonly name: T; readonly size: T }\n',
      'src/f.ts': 'export interface Row<K> { readonly id: K; readonly name: K; readonly size: K }\n',
      'src/g.ts':
        'export interface Base { readonly x: 1 }\nexport interface Row2 extends Base { readonly id: string; readonly name: string; readonly size: number }\n',
      'src/h.ts': 'export interface Row3 { readonly id: string; readonly name: string; readonly size: number }\n',
    }),
  ).toEqual([
    ['src/b.ts', 1, 'object'],
    ['src/h.ts', 1, 'object'],
  ]);
});

test('unions of references repeat in any order; keyword-only and short unions do not', () => {
  expect(
    judge({
      'src/a.ts': 'export type Outcome = Done | Failed | Cancelled;\nexport type Maybe = string | undefined | null;\n',
      'src/b.ts': 'export type Result = Cancelled | Done | Failed;\nexport type Either = string | undefined | null;\n',
      'src/c.ts': 'export type Short = Done | Failed;\n',
      'src/d.ts': 'export type Short = Failed | Done;\n',
    }),
  ).toEqual([
    ['src/a.ts', 1, 'union'],
    ['src/b.ts', 1, 'union'],
  ]);
});

test('a set of string literals repeats across a union type, a const array, a Set and Schema.Literals; deriving one from the other does not', () => {
  const found = judge({
    'src/type.ts': "export type Kind = 'task' | 'rule' | 'spec';\n",
    'src/array.ts': "export const KINDS = ['spec', 'task', 'rule'] as const;\n",
    'src/set.ts': "export const SEEN = new Set(['rule', 'spec', 'task']);\n",
    'src/schema.ts': "export const Kinds = Schema.Literals(['task', 'spec', 'rule']);\n",
    'src/derived.ts':
      "import { KINDS } from './array';\nexport type Derived = (typeof KINDS)[number];\nexport const again = Schema.Literals(KINDS);\n",
    'src/other.ts': "export type Mode = 'a' | 'b' | 'c';\n",
  });
  expect(found).toEqual([
    ['src/array.ts', 1, 'literals'],
    ['src/schema.ts', 1, 'literals'],
    ['src/set.ts', 1, 'literals'],
    ['src/type.ts', 1, 'literals'],
  ]);
});

test('Svelte script blocks count with their own line numbers, and ignored names are skipped', () => {
  const sources = {
    'src/a.svelte':
      '<script lang="ts">\n  export type Props = { readonly id: string; readonly label: string; readonly size: number };\n</script>\n<p>a</p>',
    'src/b.svelte':
      '<p>b</p>\n<script lang="ts">\n  export type Props = { readonly id: string; readonly label: string; readonly size: number };\n</script>',
  };
  expect(judge(sources)).toEqual([
    ['src/a.svelte', 2, 'object'],
    ['src/b.svelte', 3, 'object'],
  ]);
  expect(judge(sources, { ignoreNames: ['Props'] })).toEqual([]);
});

test('a referenced type counts by the declaration it names, not by its spelling', () => {
  const page = (row: string, name = 'Row') =>
    `${row}\nexport type Page = { readonly items: number; readonly value: ${name}; readonly next: string };\n`;
  expect(
    judge({
      'src/a.ts': page("import type { Row } from './rows-a';"),
      'src/b.ts': page("import type { Row } from './rows-b';"),
      'src/c.ts': page('type Row = { readonly own: string };'),
      'src/d.ts': page('type Row = { readonly own: string };'),
    }),
  ).toEqual([]);
  expect(
    judge({
      'src/c.ts': page("import type { Row } from './lib/shared/row.js';"),
      'src/deep/d.ts': page("import type { Row as Entry } from '../lib/shared/row';", 'Entry'),
      'src/e.ts': page("import type { Row } from '$lib/shared/row';"),
      'src/f.ts': page("import type { Row } from './lib/other/row';"),
    }),
  ).toEqual([
    ['src/c.ts', 2, 'object'],
    ['src/deep/d.ts', 2, 'object'],
    ['src/e.ts', 2, 'object'],
  ]);
});

test('a fingerprint names the shape and the file, not the line, so an edit above a declaration keeps its debt', () => {
  const declared = 'export type Wide = { readonly a: string; readonly b: string; readonly c: number };\n';
  const prints = (a: string) =>
    findRepeated(corpusOf({ 'src/a.ts': a, 'src/b.ts': declared }, params), params).map((one) => one.fingerprint);
  expect(prints(declared)).toEqual(prints(`// lead\n\nconst padding = 1;\n${declared}`));
  expect(new Set(prints(declared)).size).toBe(2);
});
