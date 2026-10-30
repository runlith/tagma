import { expect, test } from 'bun:test';
import ts from 'typescript';
import { couplingFindings, measureCoupling } from './coupling';
import { indexedWords, listedWords, vendorFindings, vendorWords } from './strings';
import { production, type Module, type Snapshot } from './snapshot';
import type { CouplingMeasure } from './inspections';

const snapshot = (sources: Readonly<Record<string, string>>, modules: readonly Module[] = []): Snapshot => ({
  tree: {
    has: (path) => sources[path] !== undefined,
    read: (path) => {
      const text = sources[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    },
    paths: function* () {
      yield* Object.keys(sources);
    },
  },
  paths: Object.keys(sources).filter(production),
  modules,
  file: (path) => ts.createSourceFile(path, sources[path]!, ts.ScriptTarget.Latest, true),
});

const server = 'apps/tagma/server/src';

test('vendor strings follow adapter declarations, decode escapes and ignore non-vendor cursor keys and declared exemptions', () => {
  const tree = snapshot({
    'packages/adapter-orbit/src/adapter.ts':
      "import type { ProviderDescription as Description } from '@runlith/llm/models/description'; export const ORBIT_PROVIDER = 'orbit-cloud'; export const described = { id: 'orbit-browser' } satisfies Description; export const typed: Description = { id: 'orbit-local' }; export const cast = <Description>{ id: 'orbit-shell' }; export const model = { id: 'not-a-provider' }; export const direct = defineAdapter(() => [{ id: 'orbital-cli', kind: 'harness', auth: 'cli' }]); export const catalog = { providers: [{ id: 'orbit-data' }] };",
    'packages/adapter-orbit/src/binary.ts': "export const ORBIT_PROVIDER = 'orbit'; export const ORBIT_CLI_PROVIDER = 'orbit-cli';",
    [`${server}/translations/translate.ts`]:
      "const provider = 'orbit-cloud:model'; const command = `orbit-cli`; const escaped = 'orb\\u0069t'; const cursor = placeRole('cursor'); const page = new URL('https://example.test').searchParams.get('cursor'); type Page = Omit<Fields, 'cursor'>; // orbit-cloud",
    [`${server}/external-harnesses/steps/old.ts`]: "const provider = 'orbit-cloud';",
    [`${server}/editors/choice.ts`]: "const editor = 'orbit';",
    [`${server}/translations/data.fixture.ts`]: "export const payload = 'orbit-cloud';",
    [`${server}/translations/translate.test.ts`]: "const provider = 'orbit-cloud';",
    [`${server}/translations/testing.ts`]: "export const fixture = 'orbit-cloud';",
    [`${server}/translations/runtime.generated.ts`]: "export const modules = { '@runlith/adapter-orbit': 1 };",
    [`${server}/translations/selection.ts`]: "const pickedProvider = 'cursor'; const theme = { label: 'Cursor', key: 'cursor' };",
    [`${server}/providers/pagination.ts`]:
      "const readAdapters = operation({ id: 'read_adapters', refusals: ['bad-cursor', 'cursor-stale'], cursor: Flag.String('cursor') }).pipe(registerProviders); const renderClient = Effect.gen(function* () { return `before is not a page cursor: ${raw}`; }); const html = `<style>button { cursor:pointer; }</style>`; const theme = { id: 'terminal.cursor', label: 'Cursor' };",
    [`${server}/browser/mark.ts`]:
      "const mark = Effect.fn('browser.mark')(function* () { yield* Effect.logDebug(`no agent cursor: ${reason}`); });",
  });
  const words = [...vendorWords(tree), 'cursor'];
  expect(new Set(words)).toEqual(
    new Set(['orbit', 'orbit-browser', 'orbit-cloud', 'orbit-local', 'orbit-shell', 'orbit-cli', 'orbit-data', 'orbital-cli', 'cursor']),
  );
  const params = { source: server, exclude: ['external-harnesses/steps/**', 'editors/**'] };
  const expected = [
    `vendor:orbit-cloud:${server}/translations/translate.ts`,
    `vendor:orbit-cli:${server}/translations/translate.ts`,
    `vendor:orbit:${server}/translations/translate.ts`,
    `vendor:cursor:${server}/translations/selection.ts`,
  ];
  expect(vendorFindings(tree, params, listedWords(words)).map((one) => one.fingerprint)).toEqual(expected);
  const known = new Set(words);
  const indexed = vendorFindings(
    tree,
    params,
    indexedWords((word) => known.has(word)),
  );
  expect(indexed.map((one) => one.fingerprint)).toEqual(expected);
});

test('coupling counts literal imports against the narrowest module and keeps reductions below the baseline as the next commit’s ceiling', () => {
  const modules: Module[] = [
    {
      id: 'a',
      paths: [
        { kind: 'dir', ref: 'packages/a' },
        { kind: 'file', ref: 'packages/b/src/foreign.ts' },
      ],
    },
    { id: 'b', paths: [{ kind: 'dir', ref: 'packages/b' }] },
    { id: 'b-wire', paths: [{ kind: 'dir', ref: 'packages/b/src/wire' }] },
    { id: 'app', paths: [{ kind: 'dir', ref: 'apps/tagma/app/src' }] },
    { id: 'workspace', paths: [{ kind: 'dir', ref: 'apps/tagma/app/src/lib/features/workspace' }] },
  ];
  const tree = snapshot(
    {
      'packages/a/package.json': '{"name":"@example/a"}',
      'packages/b/package.json': '{"name":"@example/b","exports":{"./wire":"./src/wire/row.ts"}}',
      'packages/a/src/local.ts': 'export const own = 1;',
      'packages/a/src/testing.ts': "import { test } from '@example/testbed'; export const helper = test;",
      'packages/a/src/use.ts':
        "import { own } from './local.js'; import { row } from '@example/b/wire'; import type { Row } from '@example/b/wire'; import { Effect } from 'effect';",
      'packages/b/src/wire/row.ts': 'export const row = 1;',
      'packages/b/src/foreign.ts': "export { own } from '../../a/src/local.js'; const lazy = import('../../a/src/local.js');",
      'apps/tagma/app/src/lib/app/own.ts': 'export const own = 1;',
      'apps/tagma/app/src/lib/features/workspace/port.ts': 'export const port = 1;',
      'apps/tagma/app/src/client.ts': "import { own } from '$lib/app/own'; import { port } from '$lib/features/workspace/port';",
    },
    modules,
  );
  const measured = measureCoupling(tree, [{ prefix: '$lib/', dir: 'apps/tagma/app/src/lib/' }]);
  const app = measured.find((one) => one.id === 'app')!;
  expect([app.modules, app.outside, app.total]).toEqual([1, 1, 2]);
  const a = measured.find((one) => one.id === 'a')!;
  expect([a.modules, a.outside, a.total]).toEqual([2, 3, 6]);
  expect(measured.find((one) => one.id === 'b-wire')?.total).toBe(0);
  const baseline: CouplingMeasure[] = [a, { id: 'other', path: 'packages/other/src/row.ts', modules: 2, outside: 2, total: 4 }];
  expect(couplingFindings([{ ...a, modules: 0, outside: 0 }], { baseline, aliases: [] }, null)).toEqual([]);
  const reduced = { ...a, modules: 1, outside: 1, total: 4 };
  const regressed = { ...a, modules: 2, outside: 2, total: 4 };
  const findings = couplingFindings([regressed], { baseline, aliases: [] }, [reduced]);
  expect(findings.filter((one) => one.fingerprint.endsWith('-increase')).map((one) => one.value)).toEqual([2, 0.5]);
  expect(findings.filter((one) => one.fingerprint.endsWith('-ceiling'))).toHaveLength(0);
  const newcomer = { ...a, id: 'new', modules: 1, outside: 1, total: 4 };
  expect(couplingFindings([newcomer], { baseline, aliases: [] }, null)).toHaveLength(0);
  expect(
    couplingFindings([{ ...newcomer, modules: 3, outside: 4 }], { baseline, aliases: [] }, null).map((one) => one.fingerprint),
  ).toEqual(['coupling:new:modules-ceiling', 'coupling:new:share-ceiling']);
});
