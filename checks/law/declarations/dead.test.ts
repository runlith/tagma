import { expect, test } from 'bun:test';
import { findDead, findDeadAmong } from './dead';
import type { DeadParams } from './declaration';
import { corpusOf } from './sources';

const params: DeadParams = {
  region: ['src/', 'packages/'],
  tests: ['**/*.test.ts', '**/testing/**'],
  entries: ['src/entry.ts'],
  kinds: ['function', 'class', 'const', 'type', 'interface', 'enum', 'namespace', 'default'],
  published: [],
  aliases: [],
};

const judge = (sources: Record<string, string>, over: Partial<DeadParams> = {}) => {
  const merged = { ...params, ...over };
  return findDead(corpusOf(sources, merged), merged).map((one) => one.fingerprint);
};

test('an export no production file imports is dead, even when a test imports it', () => {
  expect(
    judge({
      'src/main.ts': "import { used } from './a';\nexport const run = () => used();\n",
      'src/a.ts': 'export const used = () => 1;\nexport const unused = () => 2;\nexport type Gone = { readonly id: string };\n',
      'src/a.test.ts': "import { unused } from './a';\nunused();\n",
      'src/testing/support.ts': "import { Gone } from '../a';\nexport const fake: Gone = { id: 'x' };\n",
      'src/entry.ts': "import { run } from './main';\nexport const go = run;\n",
    }),
  ).toEqual(['dead src/a.ts#unused', 'dead src/a.ts#Gone']);
});

test('every way of importing a non-function export keeps it live: type-only, aliased, default, namespace members, dynamic and glob loads', () => {
  expect(
    judge({
      'src/consumer.ts': [
        "import type { Shape } from './kinds';",
        "import { original as renamed } from './renames';",
        "import chosen from './defaults';",
        "import * as math from './math';",
        'export const total = (shape: Shape): number => renamed + chosen + math.add;',
        "export const later = () => import('./lazy');",
        'export const stepped = (name: string) => import(`./steps/${name}.ts`);',
        "export const registry = import.meta.glob('./registered/*.ts', { eager: true });",
      ].join('\n'),
      'src/entry.ts':
        "import { total, later, stepped, registry } from './consumer';\nexport const all = [total, later, stepped, registry];\n",
      'src/kinds.ts': 'export type Shape = { readonly id: string };\n',
      'src/renames.ts': 'export const original = 1;\n',
      'src/defaults.ts': 'export default 1;\n',
      'src/math.ts': 'export const add = 1;\nexport const unusedMember = 1;\n',
      'src/lazy.ts': 'export const anything = 1;\n',
      'src/steps/one.ts': 'export const step = 1;\n',
      'src/registered/panel.ts': 'export const panel = 1;\n',
    }),
  ).toEqual(['dead src/math.ts#unusedMember']);
});

test('an exported function needs a runtime caller: type-only imports, typeof positions and unused imports are not calls', () => {
  const found = findDead(
    corpusOf(
      {
        'src/functions.ts': [
          'export const called = () => 1;',
          'export const passed = () => 2;',
          'export function typedOnly() {}',
          'export function typeofOnly() {}',
          'export function unusedImport() {}',
          'export function viaNamespace() {}',
          'export function namespaceTypeofOnly() {}',
          'export function neverImported() {}',
        ].join('\n'),
        'src/user.ts': [
          "import { called, passed, unusedImport, type typedOnly, typeofOnly } from './functions';",
          "import * as space from './functions';",
          'export const result = [called(), [1].map(passed), space.viaNamespace()];',
          'export type Shape = { a: typeof typeofOnly; b: typeof space.namespaceTypeofOnly; c: typedOnly };',
        ].join('\n'),
        'src/entry.ts': "import { result } from './user';\nexport type { Shape } from './user';\nexport const all = result;\n",
      },
      params,
    ),
    params,
  ).map((one) => [one.fingerprint, one.message]);
  expect(found).toEqual([
    [
      'dead src/functions.ts#typedOnly',
      'exported function `typedOnly` has no production caller; production code only reaches it in type positions or reads its metadata',
    ],
    [
      'dead src/functions.ts#typeofOnly',
      'exported function `typeofOnly` has no production caller; production code only reaches it in type positions or reads its metadata',
    ],
    [
      'dead src/functions.ts#unusedImport',
      'exported function `unusedImport` has no production caller; production code only reaches it in type positions or reads its metadata',
    ],
    [
      'dead src/functions.ts#namespaceTypeofOnly',
      'exported function `namespaceTypeofOnly` has no production caller; production code only reaches it in type positions or reads its metadata',
    ],
    ['dead src/functions.ts#neverImported', 'exported function `neverImported` is imported by no production file'],
  ]);
});

test('reading only the metadata of an exported function is not calling it, but passing, binding, calling or applying it is', () => {
  const found = judge({
    'src/functions.ts': [
      'export function never() {}',
      'export function lengthOnly() {}',
      'export function elementOnly() {}',
      'export function typeofRuntime() {}',
      'export function spaceName() {}',
      'export function spaceLength() {}',
      'export function spaceCalled() {}',
      'export function passed() {}',
      'export function bound() {}',
      'export function applied() {}',
      'export function namedAndCalled() {}',
      'export function returned() {}',
      'export function sameNameMember() {}',
    ].join('\n'),
    'src/user.ts': [
      "import { never, lengthOnly, elementOnly, typeofRuntime, passed, bound, applied, namedAndCalled, returned } from './functions';",
      "import * as space from './functions';",
      'export const facts = [never.name, lengthOnly.length, elementOnly["name"], typeof typeofRuntime, namedAndCalled.name];',
      'export const names = [space.spaceName.name, space.spaceLength?.length, typeof space.spaceName];',
      'export const calls = [[1].map(passed), bound.bind(null), applied.call(null), namedAndCalled(), space.spaceCalled(), returned.toString, (() => returned)()];',
      'export const members = { sameNameMember: space.sameNameMember };',
    ].join('\n'),
    'src/entry.ts': "import { facts, names, calls, members } from './user';\nexport const all = [facts, names, calls, members];\n",
  });
  expect(found).toEqual([
    'dead src/functions.ts#never',
    'dead src/functions.ts#lengthOnly',
    'dead src/functions.ts#elementOnly',
    'dead src/functions.ts#typeofRuntime',
    'dead src/functions.ts#spaceName',
    'dead src/functions.ts#spaceLength',
  ]);
});

test('import-type expressions consume only their named export, never a runtime caller or unrelated export', () => {
  expect(
    judge({
      'src/types.ts': 'export type Shape = { id: string };\nexport function factory() {}\nexport const unrelated = 1;\n',
      'src/entry.ts': "export type Row = import('./types').Shape;\nexport type Factory = typeof import('./types').factory;\n",
    }),
  ).toEqual(['dead src/types.ts#factory', 'dead src/types.ts#unrelated']);
});

test('a class heritage expression is a runtime use and an implements or interface heritage is a type position', () => {
  expect(
    judge({
      'src/bases.ts':
        'export const mixin = <T>(base: T) => base;\nexport class Base {}\nexport function Contract() {}\nexport function Asserted() {}\n',
      'src/entry.ts': [
        "import { mixin, Base, Contract, Asserted } from './bases';",
        'export class Derived extends mixin(Base) implements Contract {}',
        'export interface Shape extends Asserted {}',
      ].join('\n'),
    }),
  ).toEqual(['dead src/bases.ts#Contract', 'dead src/bases.ts#Asserted']);
});

test('an export one production file imports is live even when that file is itself unreachable; liveness is not transitive', () => {
  expect(
    judge({
      'src/orphan-user.ts': "import { helper } from './helpers';\nexport const unusedEntry = () => helper();\n",
      'src/helpers.ts': 'export const helper = () => 1;\n',
    }),
  ).toEqual(['dead src/orphan-user.ts#unusedEntry']);
});

test('re-exports count as consumers of the file that defines the export', () => {
  expect(
    judge({
      'src/entry.ts': "import { shown, Kind, extra } from './barrel';\nexport const used = [shown, extra];\nexport type Local = Kind;\n",
      'src/barrel.ts': "export { shown, Kind } from './impl';\nexport * from './more';\n",
      'src/impl.ts': 'export const shown = 1;\nexport type Kind = string;\nexport const hidden = 2;\n',
      'src/more.ts': 'export const extra = 3;\n',
    }),
  ).toEqual(['dead src/impl.ts#hidden']);
});

test('a file without exports is never reported, and a file with exports nothing imports is reported per export', () => {
  expect(
    judge({
      'src/main.ts': 'console.log("side effect");\n',
      'src/setup.ts': 'import "./main";\n',
      'src/lonely.ts': 'export const one = 1;\nexport const two = 2;\n',
    }),
  ).toEqual(['dead src/lonely.ts#one', 'dead src/lonely.ts#two']);
});

test('a published package entry, a bin, an entry glob and an alias are production consumers', () => {
  expect(
    judge(
      {
        'packages/kit/package.json': JSON.stringify({
          name: '@scope/kit',
          exports: { '.': './src/index.ts', './rules': { types: './src/rules.ts', default: './src/rules.ts' } },
        }),
        'packages/kit/src/index.ts': 'export const api = 1;\n',
        'packages/kit/src/rules.ts': 'export const defineRules = 1;\n',
        'packages/tool/package.json': JSON.stringify({
          name: '@scope/tool',
          private: true,
          bin: { tool: './src/cli.ts' },
          exports: { './internal': './src/internal.ts' },
        }),
        'packages/tool/src/cli.ts': 'export const main = 1;\n',
        'packages/tool/src/internal.ts': 'export const secret = 1;\n',
        'packages/app/package.json': JSON.stringify({ name: '@scope/app', private: true }),
        'packages/app/src/use.ts':
          "import { shared } from '$lib/shared';\nimport { fromKit } from '@scope/consumed';\nexport const both = [shared, fromKit];\n",
        'packages/app/src/lib/shared.ts': 'export const shared = 1;\n',
        'packages/consumed/package.json': JSON.stringify({ name: '@scope/consumed', exports: { '.': './src/main.ts' } }),
        'packages/consumed/src/main.ts': 'export const fromKit = 1;\nexport const unusedFromKit = 2;\n',
      },
      { published: ['packages/kit'], aliases: [{ prefix: '$lib/', dir: 'packages/app/src/lib' }], entries: ['packages/app/src/use.ts'] },
    ),
  ).toEqual(['dead packages/consumed/src/main.ts#unusedFromKit', 'dead packages/tool/src/internal.ts#secret']);
});

test('test files, testing folders and declaration files are neither consumers nor judged', () => {
  expect(
    judge({
      'src/main.ts': "import { shape } from './shape';\nexport const run = () => shape;\n",
      'src/entry.ts': "import { run } from './main';\nexport const go = run;\n",
      'src/shape.ts': 'export const shape = 1;\n',
      'src/shape.test.ts': 'export const fixture = 1;\n',
      'src/testing/fake.ts': 'export const fake = 1;\n',
      'src/types.d.ts': 'export interface Declared { id: string }\n',
    }),
  ).toEqual([]);
});

test('a Svelte component keeps imports it uses only in markup and exposes its module-script exports', () => {
  expect(
    judge({
      'src/Panel.svelte': [
        '<script module lang="ts">',
        '  export const created = 1;',
        '  export const spare = 2;',
        '</script>',
        '<script lang="ts">',
        "  import { label } from './label';",
        "  import { spread } from './spread';",
        "  import { unused } from './unused';",
        '  export let ignored = 1;',
        '</script>',
        '<p>{label(1)}</p>',
        '<List items={[...spread]} />',
      ].join('\n'),
      'src/entry.ts': "import { created } from './Panel.svelte';\nexport const made = created;\n",
      'src/label.ts': 'export const label = (n: number) => `${n}`;\n',
      'src/spread.ts': 'export const spread = [1];\n',
      'src/unused.ts': 'export const unused = () => 1;\n',
    }),
  ).toEqual(['dead src/Panel.svelte#spare', 'dead src/unused.ts#unused']);
});

test('a judged set reports only its own files', () => {
  const sources = {
    'src/changed.ts': 'export const wanted = 1;\nexport const added = 2;\n',
    'src/other.ts': 'export const stray = 1;\n',
    'src/consumer.ts': "import { wanted } from './changed';\nexport const use = () => wanted;\n",
  };
  const corpus = corpusOf(sources, params);
  expect(findDeadAmong(corpus, params, new Set(['src/changed.ts'])).map((one) => one.fingerprint)).toEqual(['dead src/changed.ts#added']);
});
