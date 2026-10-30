import { expect, test } from 'bun:test';
import { findDead } from './dead';
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

const live = "import { used } from './a'; export const run = () => used();\n";

test('an export no production file imports is dead, even when a test imports it', () => {
  expect(
    judge({
      'src/main.ts': live,
      'src/a.ts': 'export const used = () => 1;\nexport const unused = () => 2;\nexport type Gone = { readonly id: string };\n',
      'src/a.test.ts': "import { unused } from './a';\nunused();\n",
      'src/testing/support.ts': "import { Gone } from '../a';\nexport const fake: Gone = { id: 'x' };\n",
      'src/entry.ts': "import { run } from './main';\nrun();\n",
    }),
  ).toEqual(['dead src/a.ts#unused', 'dead src/a.ts#Gone']);
});

test('every way of importing an export keeps it live: type-only, aliased, default, namespace members, dynamic and glob loads', () => {
  expect(
    judge({
      'src/consumer.ts': [
        "import type { Shape } from './kinds';",
        "import { original as renamed } from './renames';",
        "import chosen from './defaults';",
        "import * as math from './math';",
        'export const total = (shape: Shape): number => renamed() + chosen() + math.add(1, 2);',
        "export const later = () => import('./lazy');",
        'export const stepped = (name: string) => import(`./steps/${name}.ts`);',
        "export const registry = import.meta.glob('./registered/*.ts', { eager: true });",
      ].join('\n'),
      'src/entry.ts':
        "import { total, later, stepped, registry } from './consumer';\nexport const all = [total, later, stepped, registry];\n",
      'src/kinds.ts': 'export type Shape = { readonly id: string };\n',
      'src/renames.ts': 'export const original = () => 1;\n',
      'src/defaults.ts': 'export default () => 1;\n',
      'src/math.ts': 'export const add = (a: number, b: number) => a + b;\nexport const unusedMember = 1;\n',
      'src/lazy.ts': 'export const anything = 1;\n',
      'src/steps/one.ts': 'export const step = 1;\n',
      'src/registered/panel.ts': 'export const panel = 1;\n',
    }),
  ).toEqual(['dead src/math.ts#unusedMember']);
});

test('a namespace import used as a whole keeps every member of the file live', () => {
  expect(
    judge({
      'src/entry.ts': "import * as everything from './parts';\nexport const all = everything;\n",
      'src/parts.ts': 'export const a = 1;\nexport const b = 2;\n',
    }),
  ).toEqual([]);
});

test('re-exports forward liveness to the file that defines the export', () => {
  expect(
    judge({
      'src/entry.ts': [
        "import { shown, Kind, extra } from './barrel';",
        "import * as space from './nested';",
        'export const used = [shown, extra, space.deep];',
        'export type Local = Kind;',
      ].join('\n'),
      'src/barrel.ts': "export { shown, Kind } from './impl';\nexport * from './more';\n",
      'src/impl.ts': 'export const shown = 1;\nexport type Kind = string;\nexport const hidden = 2;\n',
      'src/more.ts': 'export const extra = 3;\nexport const spare = 4;\n',
      'src/nested.ts': "export * as inner from './deep';\nexport const deep = 1;\n",
      'src/deep.ts': 'export const buried = 1;\n',
    }),
  ).toEqual(['dead src/deep.ts#buried', 'dead src/impl.ts#hidden', 'dead src/more.ts#spare']);
});

test('an export reached only from dead code is dead, and one with another live caller stays live', () => {
  const found = findDead(
    corpusOf(
      {
        'src/orphan-user.ts':
          "import { shared, helper } from './helpers';\nexport const unusedEntry = () => helper() + shared();\nexport const kept = 1;\n",
        'src/live-user.ts': "import { shared } from './helpers';\nexport const live = () => shared();\n",
        'src/entry.ts': "import { live } from './live-user';\nimport { kept } from './orphan-user';\nexport const all = [live, kept];\n",
        'src/helpers.ts': 'export const helper = () => 1;\nexport const shared = () => 2;\n',
      },
      params,
    ),
    params,
  ).map((one) => [one.fingerprint, one.message]);
  expect(found).toEqual([
    ['dead src/helpers.ts#helper', 'exported function `helper` has no production caller; only dead code or tests reach it'],
    ['dead src/orphan-user.ts#unusedEntry', 'exported function `unusedEntry` is imported by no production file'],
  ]);
});

test('a published package entry, a bin and an alias are production consumers; a private unimported entry is a dead file', () => {
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
  ).toEqual(['dead packages/consumed/src/main.ts#unusedFromKit', 'dead-file packages/tool/src/internal.ts']);
});

test('a file nothing loads is one dead-file finding unless an entry glob names it', () => {
  const sources = {
    'src/main.ts': live,
    'src/a.ts': 'export const used = 1;\n',
    'src/scripts/build.ts': 'export const one = 1;\nexport const two = 2;\n',
    'src/config.ts': 'export default {};\n',
  };
  expect(judge(sources)).toEqual(['dead-file src/config.ts', 'dead-file src/main.ts', 'dead-file src/scripts/build.ts']);
  expect(judge(sources, { entries: ['src/scripts/*.ts', 'src/main.ts', 'src/config.ts'] })).toEqual([]);
});

test('test files, testing folders and declaration files are neither consumers nor judged', () => {
  expect(
    judge({
      'src/main.ts': "import { shape } from './shape';\nexport const run = () => shape;\n",
      'src/entry.ts': "import { run } from './main';\nrun();\n",
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
        "  import { orphan } from './orphan';",
        '  export let ignored = 1;',
        '</script>',
        '<p>{label(1)}</p>',
        '<List items={[...spread]} />',
      ].join('\n'),
      'src/entry.ts': "import { created } from './Panel.svelte';\nexport const made = created;\n",
      'src/label.ts': 'export const label = (n: number) => `${n}`;\n',
      'src/spread.ts': 'export const spread = [1];\n',
      'src/orphan.ts': 'export const orphan = 1;\n',
    }),
  ).toEqual(['dead src/Panel.svelte#spare', 'dead src/orphan.ts#orphan']);
});

test('a judged scope reports only its own files and takes the importers it names as live', () => {
  const sources = {
    'src/changed.ts': 'export const wanted = 1;\nexport const added = 2;\n',
    'src/consumer.ts': "import { wanted } from './changed';\nexport const use = () => wanted;\n",
  };
  const corpus = corpusOf(sources, params);
  const found = findDead(corpus, params, { judged: new Set(['src/changed.ts']), rooted: new Set(['src/consumer.ts']) }).map(
    (one) => one.fingerprint,
  );
  expect(found).toEqual(['dead src/changed.ts#added']);
});
