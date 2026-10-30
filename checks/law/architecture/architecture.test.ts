import { expect, test } from 'bun:test';
import ts from 'typescript';
import { indexedWords, listedWords, vendorFindings, vendorWords } from './strings';
import { production, type Module, type Snapshot } from './snapshot';

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
    [`${server}/plugins/conventions.ts`]: "const provider = 'orbit-cloud';",
    [`${server}/external-harnesses/launch.ts`]: "const provider = 'orbital-cli';",
    [`${server}/editors/choice.ts`]: "const editor = 'orbit';",
    [`${server}/translations/data.fixture.ts`]: "export const payload = 'orbit-cloud';",
    [`${server}/translations/translate.test.ts`]: "const provider = 'orbit-cloud';",
    [`${server}/translations/testing.ts`]: "export const fixture = 'orbit-cloud';",
    [`${server}/translations/runtime.generated.ts`]: "export const modules = { '@runlith/adapter-orbit': 1 };",
    [`${server}/translations/selection.ts`]: "const pickedProvider = 'cursor'; const theme = { label: 'Cursor', key: 'cursor' };",
    [`${server}/translations/compare.ts`]: "export const hosted = (id: string) => id === 'cursor';",
    [`${server}/providers/pagination.ts`]:
      "const readAdapters = operation({ id: 'read_adapters', refusals: ['bad-cursor', 'cursor-stale'], cursor: Flag.String('cursor') }).pipe(registerProviders); const renderClient = Effect.gen(function* () { return `before is not a page cursor: ${raw}`; }); const html = `<style>button { cursor:pointer; }</style>`; const theme = { id: 'terminal.cursor', label: 'Cursor' };",
    [`${server}/browser/mark.ts`]:
      "const mark = Effect.fn('browser.mark')(function* () { yield* Effect.logDebug(`no agent cursor: ${reason}`); });",
  });
  const words = [...vendorWords(tree), 'cursor'];
  expect(new Set(words)).toEqual(
    new Set(['orbit', 'orbit-browser', 'orbit-cloud', 'orbit-local', 'orbit-shell', 'orbit-cli', 'orbit-data', 'orbital-cli', 'cursor']),
  );
  const params = { source: server, include: ['translations/**', 'external-harnesses/**'], exclude: ['external-harnesses/steps/**'] };
  const expected = [
    `vendor:orbit-cloud:${server}/translations/translate.ts`,
    `vendor:orbit-cli:${server}/translations/translate.ts`,
    `vendor:orbit:${server}/translations/translate.ts`,
    `vendor:orbital-cli:${server}/external-harnesses/launch.ts`,
    `vendor:cursor:${server}/translations/selection.ts`,
    `vendor:cursor:${server}/translations/compare.ts`,
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
