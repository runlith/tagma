import { expect, test } from 'bun:test';
import type { Boundaries } from '../architecture/boundaries';
import type { RepeatedParams } from './declaration';
import { findRepeated } from './repeated';
import { corpusOf } from './sources';

const params: RepeatedParams = {
  region: ['src/', 'packages/'],
  tests: ['**/*.test.ts', '**/testing/**'],
  scope: 'all',
  minMembers: 3,
  minUnion: 3,
  minLiterals: 3,
  ignoreNames: [],
  aliases: [{ prefix: '$lib/', dir: 'src/lib' }],
};
const boundaries = (relations: readonly (readonly [string, string])[] = [], owners: Readonly<Record<string, string>> = {}): Boundaries => ({
  owner: (path) => owners[path] ?? path,
  imports: (from, to) => relations.some(([a, b]) => from === a && to === b),
});
const judge = (files: Record<string, string>, map: Boundaries = boundaries(), over: Partial<RepeatedParams> = {}) => {
  const merged = { ...params, ...over };
  return findRepeated(corpusOf(files, merged), merged, map);
};
const paths = (files: Record<string, string>, map?: Boundaries, over?: Partial<RepeatedParams>) =>
  judge(files, map, over).map((one) => one.path);
const wide = 'export type Shared = { readonly a: string; readonly b: string; readonly c: number };\n';

test('an alias that only renames an imported type reports the alias, while a projection, generic application and local alias are clean', () => {
  const files = {
    'src/owner.ts': wide,
    'src/use.ts':
      "import type { Shared as Imported } from './owner';\nexport type Copy = Imported;\nexport type Member = Imported['a'];\nexport type Instance = Generic<Imported>;\ntype Local = { value: string };\nexport type Own = Local;\n",
  };
  expect(judge(files).map((one) => [one.path, one.line, one.fingerprint])).toEqual([['src/use.ts', 2, 'repeated alias:Copy src/use.ts']]);
});

test('same-name equal types repeat across modules, even below the copy threshold, but not inside one module or in test code', () => {
  const files = {
    'src/a.ts': 'export type Position = { readonly line: number };\n',
    'src/b.ts': 'export interface Position { readonly line: number }\n',
    'src/c.test.ts': 'export type Position = { readonly line: number };\n',
  };
  expect(paths(files)).toEqual(['src/a.ts', 'src/b.ts']);
  expect(paths(files, boundaries([], { 'src/a.ts': 'one', 'src/b.ts': 'one' }))).toEqual([]);
});

test('a copy of an exported dependency type needs at least three members or alternatives and is reported only at its redeclaration', () => {
  const files = {
    'src/owner.ts': wide + "export type Mode = 'one' | 'two' | 'three';\nexport type Pair = { readonly a: string; readonly b: string };\n",
    'src/copy.ts':
      "type Local = { readonly c: number; readonly b: string; readonly a: string };\ntype Choice = 'three' | 'one' | 'two';\ntype Small = { readonly a: string; readonly b: string };\n",
  };
  const map = boundaries([['src/copy.ts', 'src/owner.ts']]);
  expect(judge(files, map).map((one) => [one.path, one.line])).toEqual([
    ['src/copy.ts', 1],
    ['src/copy.ts', 2],
  ]);
  expect(paths(files)).toEqual([]);
  expect(paths({ 'src/owner.ts': wide.replace('export ', ''), 'src/copy.ts': files['src/copy.ts']! }, map)).toEqual([]);
});

test('ProgramRan repeats an exported ProgramOutput already reached by the harness module', () => {
  const output = '{ readonly stdout: string; readonly stderr: string; readonly exit: number | null };\n';
  const files = {
    'src/run.ts': `export type ProgramRan = ${output}`,
    'packages/tagma/src/adapter/provider.ts': `export type ProgramOutput = ${output}`,
  };
  expect(
    paths(
      files,
      boundaries([['external-harnesses', '@runlith/tagma']], {
        'src/run.ts': 'external-harnesses',
        'packages/tagma/src/adapter/provider.ts': '@runlith/tagma',
      }),
    ),
  ).toEqual(['src/run.ts']);
});

test('same-module shapes stay outside the shared-type inspection, including selection copies and literal settings', () => {
  const selection =
    '{ readonly provider: string; readonly model: string | null; readonly reasoning: string | null; readonly account: string | null };\n';
  const files = {
    'src/asks.ts': `export type ThreadSelection = ${selection}`,
    'src/recap.ts': `export type RecapSelection = ${selection}`,
  };
  const map = boundaries([], { 'src/asks.ts': 'threads', 'src/recap.ts': 'threads' });
  expect(paths(files, map)).toEqual([]);
  expect(paths({ 'src/asks.ts': `${files['src/asks.ts']}${files['src/recap.ts']}` }, map)).toEqual([]);
  expect(
    paths({ 'src/asks.ts': "type RenderMode = 'auto'|'on'|'off';", 'src/recap.ts': "type LigatureMode = 'auto'|'on'|'off';" }, map),
  ).toEqual([]);
});

test('independent ranges, focus policies and settings with equal shapes stay separate named concepts', () => {
  expect(
    paths({
      'src/speech.ts': 'export type Silenced = { readonly from: number; readonly to: number };\n',
      'src/editor.ts': 'export type LineRange = { readonly from: number; readonly to: number };\n',
      'src/layer.ts': 'export type ReturnFocus = false | (() => HTMLElement | null);\n',
      'src/popover.ts': 'export type InitialFocus = false | (() => HTMLElement | null);\n',
      'src/render.ts': "export type RenderMode = 'auto' | 'on' | 'off';\n",
      'src/ligatures.ts': "export type LigatureMode = 'auto' | 'on' | 'off';\n",
    }),
  ).toEqual([]);
});

test('field-key maps and error maps, and selection positions and replacement edits, remain independent within their modules', () => {
  const map = boundaries([], { 'src/slots.ts': 'graph', 'src/errors.ts': 'graph', 'src/selection.ts': 'chat', 'src/edit.ts': 'chat' });
  expect(
    paths(
      {
        'src/slots.ts': 'type Slots = { readonly id?: string; readonly entries?: string; readonly order?: string };',
        'src/errors.ts': 'type Unreadable = { readonly id?: string; readonly entries?: string; readonly order?: string };',
        'src/selection.ts': 'type PromptSelection = { readonly text: string; readonly from: number; readonly to: number };',
        'src/edit.ts': 'type PromptEdit = { readonly from: number; readonly to: number; readonly text: string };',
      },
      map,
    ),
  ).toEqual([]);
});

test('readonly, optionality, generic parameters, heritage and referenced declaration identities distinguish shapes', () => {
  const files = {
    'src/a.ts':
      "import type { Row } from './rows-a';\nexport type Page = { readonly row: Row; readonly next?: string; readonly count: number };\n",
    'src/b.ts':
      "import type { Row } from './rows-b';\nexport type Page = { readonly row: Row; readonly next?: string; readonly count: number };\n",
    'src/c.ts':
      "import type { Row } from './rows-a';\nexport type Page = { readonly row: Row; readonly next: string; readonly count: number };\n",
    'src/d.ts': "import type { Row } from './rows-a';\nexport type Page = { row: Row; readonly next?: string; readonly count: number };\n",
    'src/e.ts': 'export interface Generic<T> { readonly a: T; readonly b: T; readonly c: T }\n',
    'src/f.ts': 'export interface Generic<K> { readonly a: K; readonly b: K; readonly c: K }\n',
    'src/g.ts': 'export interface Generic<T> extends Base { readonly a: T; readonly b: T; readonly c: T }\n',
  };
  expect(paths(files)).toEqual([]);
});

test('package exports, relative imports and configured aliases name one referenced declaration', () => {
  const page = (row: string) => `${row}\nexport type Page = { readonly row: Row; readonly next: string; readonly count: number };\n`;
  expect(
    paths({
      'packages/shared/package.json': JSON.stringify({ name: '@acme/shared', exports: { './row': './src/row.ts' } }),
      'packages/shared/src/page.ts': page("import type { Row } from './row';"),
      'packages/app/src/page.ts': page("import type { Row } from '@acme/shared/row';"),
    }),
  ).toEqual(['packages/app/src/page.ts', 'packages/shared/src/page.ts']);
  expect(
    paths({
      'src/a.ts': page("import type { Row } from '$lib/row';"),
      'src/b.ts': page("import type { Row } from './lib/row';"),
    }),
  ).toEqual(['src/a.ts', 'src/b.ts']);
});

test('Svelte declaration positions and fingerprints survive unrelated lines; value sets alone are not type copies', () => {
  const files = {
    'src/a.svelte': `<script lang="ts">\n${wide}</script>`,
    'src/b.ts': wide,
    'src/constants.ts': "export const MODES = ['one','two','three'];\n",
    'src/schema.ts': "export const Mode = Schema.Literals(['one','two','three']);\n",
  };
  const first = judge(files);
  expect(first.map((one) => [one.path, one.line])).toEqual([
    ['src/a.svelte', 2],
    ['src/b.ts', 1],
  ]);
  expect(judge({ ...files, 'src/b.ts': `\n${wide}` }).map((one) => one.fingerprint)).toEqual(first.map((one) => one.fingerprint));
  expect(paths(files, undefined, { ignoreNames: ['Shared'] })).toEqual([]);
});
