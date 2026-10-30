import { expect, test } from 'bun:test';
import { callFindings, callFrontier, exportSummary } from './analysis';
import type { CallParams } from './params';
import type { World } from './world';

const params: CallParams = {
  region: ['server/src/'],
  sources: [
    { path: 'server/src/providers/access.ts', name: 'ModelAccess', capability: 'access', form: 'service' },
    { path: 'pkg/modelPort.ts', name: 'ModelRequester', capability: 'requester', form: 'type' },
    { path: 'pkg/modelPort.ts', name: 'ModelRequest', capability: 'request', form: 'type' },
    { path: 'pkg/compaction.ts', name: 'CompactionModels', capability: 'requester', form: 'type' },
    { path: 'server/src/threads/asides.ts', name: 'HarnessAsides', capability: 'asides', form: 'service' },
    { path: 'pkg/threadAsides.ts', name: 'ThreadAsides', capability: 'asides', form: 'type' },
    { path: 'pkg/aside.ts', name: 'AgentAside', capability: 'aside', form: 'type' },
    { path: 'server/src/threads/contract/asks.ts', name: 'ThreadAsks', capability: 'asks', form: 'service' },
    { path: 'server/src/harness/adapters.ts', name: 'HarnessAdapters', capability: 'adapters', form: 'service' },
    { path: 'server/src/harness/adapter.ts', name: 'HarnessAdapter', capability: 'row', form: 'type' },
  ],
  rows: ['server/src/harness/vendors/*/row.ts'],
  allow: {
    request: ['server/src/providers', 'server/src/native/kernel.ts'],
    ask: ['server/src/threads/asks.ts'],
    row: ['server/src/harness', 'server/src/threads/harness'],
  },
};

const contracts: Record<string, string> = {
  'server/src/providers/access.ts':
    "import type { ModelRequester } from '@pkg/modelPort';\nimport { Context } from 'effect';\nexport class ModelAccess extends Context.Service<ModelAccess, ModelRequester>()('access') {}\n",
  'pkg/modelPort.ts':
    'export type ModelRequest = { readonly origin?: string; readonly rung?: string | null; stream(): unknown; text(input: unknown): unknown; object(input: unknown): unknown };\nexport interface ModelRequester { request(input: unknown): ModelRequest }\n',
  'pkg/compaction.ts':
    "import type { ModelRequest } from './modelPort';\nexport interface CompactionModels { request(input: unknown): ModelRequest }\n",
  'pkg/aside.ts':
    'export type AgentAside = { readonly source: string; readonly expiresAt: number | null; ask(question: { readonly instruction: string }): unknown };\nexport type AgentAsideHook = (aside: AgentAside) => unknown;\n',
  'pkg/threadAsides.ts': 'export type ThreadAsides = { ask(): unknown };\n',
  'server/src/threads/asides.ts':
    "import type { ThreadAsides } from '@pkg/threadAsides';\nimport { Context } from 'effect';\nexport class HarnessAsides extends Context.Service<HarnessAsides, ThreadAsides>()('asides') {}\n",
  'server/src/threads/contract/asks.ts':
    "import { Context } from 'effect';\nexport class ThreadAsks extends Context.Service<ThreadAsks, { held(id: string): unknown }>()('asks') {}\n",
  'server/src/harness/adapter.ts': 'export type HarnessAdapter = { readonly binary: string };\n',
  'server/src/harness/adapters.ts':
    "import { Context } from 'effect';\nexport class HarnessAdapters extends Context.Service<HarnessAdapters, { all(): unknown }>()('adapters') {}\n",
  'server/src/harness/table.ts':
    "import type { HarnessAdapter } from './adapter';\nexport const HARNESSES: readonly HarnessAdapter[] = [];\nexport function harnessAdapter(name: string): HarnessAdapter { throw new Error(name); }\n",
  'server/src/harness/vendors/claude/row.ts': "export const claude = { binary: 'claude' };\n",
  'server/src/threads/harness-contract.ts':
    "import { Context } from 'effect';\nexport class Harness extends Context.Service<Harness, { row(id: string): unknown }>()('harness') {}\n",
};

const SOURCE = /\.[cm]?[jt]sx?$/;

const worldOf = (files: Record<string, string>): World => {
  const all = { ...contracts, ...files };
  const has = (path: string) => Object.hasOwn(all, path);
  return {
    paths: Object.keys(all).filter((path) => SOURCE.test(path)),
    read: (path) => all[path],
    resolve: (specifier, from) => {
      if (specifier.startsWith('@pkg/')) return `pkg/${specifier.slice('@pkg/'.length)}.ts`;
      if (!specifier.startsWith('.')) return null;
      const parts = [...from.split('/').slice(0, -1)];
      for (const part of specifier.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
      }
      const base = parts.join('/').replace(/\.js$/, '');
      return [`${base}.ts`, `${base}/index.ts`].find(has) ?? null;
    },
  };
};

const found = (files: Record<string, string>, only?: readonly string[]) =>
  callFindings(worldOf(files), params, only)
    .map((one) => {
      const [, act, path, ...label] = one.fingerprint.split(':');
      return [path!, `${act}:${label.join(':')}`] as const;
    })
    .sort((left, right) => (left.join('\0') < right.join('\0') ? -1 : 1))
    .map((one) => [...one]);

const HEAD = "import { Effect } from 'effect';\nimport { ModelAccess } from '../providers/access';\n";

test('every natural way of reaching ModelAccess.request is a finding', () => {
  const files = {
    'server/src/f/yielded.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; return models.request({}); });\n`,
    'server/src/f/aliased.ts': `${HEAD.replace('ModelAccess }', 'ModelAccess as Door }')}export const run = Effect.gen(function* () { return (yield* Door).request({}); });\n`,
    'server/src/f/namespace.ts': `import { Effect } from 'effect';\nimport * as access from '../providers/access.js';\nexport const run = Effect.gen(function* () { const models = yield* access.ModelAccess; return models.request({}); });\n`,
    'server/src/f/context.ts': `import { Context } from 'effect';\n${HEAD.split('\n')[1]}\nexport const run = (graph: Context.Context<never>) => Context.get(graph, ModelAccess).request({});\n`,
    'server/src/f/flatmapped.ts': `${HEAD}export const run = Effect.flatMap(ModelAccess, (models) => Effect.sync(() => models.request({})));\n`,
    'server/src/f/used.ts': `${HEAD}export const run = ModelAccess.use((models) => models.request({}));\n`,
    'server/src/f/piped.ts': `${HEAD}export const run = ModelAccess.pipe(Effect.map((models) => models.request({})));\n`,
    'server/src/f/destructured.ts': `${HEAD}export const run = Effect.gen(function* () { const { request } = yield* ModelAccess; return request({}); });\n`,
    'server/src/f/copied.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; const ask = models.request; return ask({}); });\n`,
    'server/src/f/bound.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; return models.request.bind(models)({}); });\n`,
    'server/src/f/bracket.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; return models['request']({}); });\n`,
    'server/src/f/service.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* Effect.service(ModelAccess); return models.request({}); });\n`,
    'server/src/f/required.ts': `import { Effect } from 'effect';\nconst access = require('../providers/access');\nexport const run = Effect.gen(function* () { const models = yield* access.ModelAccess; return models.request({}); });\n`,
    'server/src/f/equals.ts': `import { Effect } from 'effect';\nimport access = require('../providers/access');\nexport const run = Effect.gen(function* () { const models = yield* access.ModelAccess; return models.request({}); });\n`,
    'server/src/f/dynamic.ts': `export const run = async () => { const { ModelAccess } = await import('../providers/access'); return ModelAccess; };\nimport { Effect } from 'effect';\nexport const asks = Effect.gen(function* () { const access = await import('../providers/access'); const models = yield* access.ModelAccess; return models.request({}); });\n`,
  };
  expect(found(files)).toEqual(
    Object.keys(files)
      .sort()
      .map((path) => [path, 'request:ModelAccess.request']),
  );
});

test('typed parameters, properties and classes establish the requester a feature calls', () => {
  const files = {
    'server/src/f/param.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport const go = (models: ModelRequester) => models.request({});\n",
    'server/src/f/service.ts':
      "import type { ModelAccess } from '../providers/access';\nexport const go = (models: ModelAccess['Service']) => models.request({});\nexport const decide = (models: ModelAccess['Service']) => models.decide();\n",
    'server/src/f/compaction.ts':
      "import type { CompactionModels } from '@pkg/compaction';\nexport const go = (models: CompactionModels) => models.request({});\n",
    'server/src/f/shape.ts':
      "import type { Context } from 'effect';\nimport { ModelAccess } from '../providers/access';\nexport const go = (models: Context.Service.Shape<typeof ModelAccess>) => models.request({});\n",
    'server/src/f/klass.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport class Feature {\n  constructor(private readonly models: ModelRequester) {}\n  go() { return this.models.request({}); }\n}\n",
    'server/src/f/field.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport class Feature {\n  private models: ModelRequester | undefined;\n  go() { return this.models?.request({}); }\n}\n",
    'server/src/f/object.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\ntype Parts = { readonly models: ModelRequester };\nexport const go = (parts: Parts) => parts.models.request({});\n",
    'server/src/f/asserted.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport const go = (anything: unknown) => (anything as ModelRequester).request({});\n",
  };
  expect(found(files)).toEqual([
    ['server/src/f/asserted.ts', 'request:ModelRequester.request'],
    ['server/src/f/compaction.ts', 'request:ModelRequester.request'],
    ['server/src/f/field.ts', 'request:ModelRequester.request'],
    ['server/src/f/klass.ts', 'request:ModelRequester.request'],
    ['server/src/f/object.ts', 'request:ModelRequester.request'],
    ['server/src/f/param.ts', 'request:ModelRequester.request'],
    ['server/src/f/service.ts', 'request:ModelAccess.decide'],
    ['server/src/f/service.ts', 'request:ModelAccess.request'],
    ['server/src/f/shape.ts', 'request:ModelAccess.request'],
  ]);
});

test('a returned request is a model call by stream, text and object, and a typed one stays visible inside a helper', () => {
  const files = {
    'server/src/f/chain.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; return models.request({}).text({}); });\n`,
    'server/src/f/typed.ts':
      "import type { ModelRequest } from '@pkg/modelPort';\nexport const a = (request: ModelRequest) => request.stream();\nexport const b = (request: ModelRequest) => request.object({});\nexport const c = (request: ModelRequest) => request['text']({});\n",
  };
  expect(found(files)).toEqual([
    ['server/src/f/chain.ts', 'request:ModelAccess.request'],
    ['server/src/f/chain.ts', 'request:ModelRequest.text'],
    ['server/src/f/typed.ts', 'request:ModelRequest.object'],
    ['server/src/f/typed.ts', 'request:ModelRequest.stream'],
    ['server/src/f/typed.ts', 'request:ModelRequest.text'],
  ]);
});

test('an imported helper that produces a request hands its capability to the caller, through barrels, aliases and declared types', () => {
  const files = {
    'server/src/providers/helpers.ts':
      "import type { ModelRequester, ModelRequest } from '@pkg/modelPort';\nimport { Effect } from 'effect';\nimport { ModelAccess } from './access';\nexport const makeRequest = (models: ModelRequester) => models.request({});\nexport declare function opened(): ModelRequest;\nexport const acquired = Effect.gen(function* () { const models = yield* ModelAccess; return models.request({}); });\n",
    'server/src/providers/index.ts': "export * from './helpers';\nexport { ModelAccess as Models } from './access';\n",
    'server/src/f/inferred.ts':
      "import { makeRequest } from '../providers/helpers';\nimport type { ModelRequester } from '@pkg/modelPort';\nexport const go = (models: ModelRequester) => makeRequest(models).text({});\n",
    'server/src/f/declared.ts': "import { opened } from '../providers/helpers';\nexport const go = () => opened().stream();\n",
    'server/src/f/yielded.ts':
      "import { Effect } from 'effect';\nimport { acquired } from '../providers/helpers';\nexport const go = Effect.gen(function* () { const request = yield* acquired; return request.object({}); });\n",
    'server/src/f/barrel.ts':
      "import { makeRequest, Models } from '../providers';\nimport { Effect } from 'effect';\nexport const go = Effect.gen(function* () { const models = yield* Models; return makeRequest(models).text({}); });\n",
    'server/src/f/mentionless.ts': "import { opened } from './opening';\nexport const go = () => opened().text({});\n",
    'server/src/f/opening.ts':
      "import type { ModelRequest } from '@pkg/modelPort';\nexport const opened = (): ModelRequest => { throw new Error('later'); };\n",
  };
  expect(found(files)).toEqual([
    ['server/src/f/barrel.ts', 'request:ModelRequest.text'],
    ['server/src/f/declared.ts', 'request:ModelRequest.stream'],
    ['server/src/f/inferred.ts', 'request:ModelRequest.text'],
    ['server/src/f/mentionless.ts', 'request:ModelRequest.text'],
    ['server/src/f/yielded.ts', 'request:ModelRequest.object'],
  ]);
});

test('an unrelated object with the same method names, a shadowed binding and a plain comment or string are clean', () => {
  const files = {
    'server/src/f/unrelated.ts':
      "import { Effect } from 'effect';\nconst client = { request: () => 1, ask: () => 2, text: () => 3 };\nexport class Http { request() { return 1; } ask() { return 2; } }\nexport const go = (http: Http, other: { request(): void }) => [client.request(), client.ask(), client.text(), http.request(), http.ask(), other.request(), Effect.succeed(1)];\n",
    'server/src/f/shadowed.ts': `${HEAD}export const run = Effect.gen(function* () {\n  const models = yield* ModelAccess;\n  { const models = { request: () => 1 }; models.request(); }\n  const again = (models: { request(): number }) => models.request();\n  const alias = (ModelAccess: { request(): void }) => ModelAccess.request();\n  return [models.served, again, alias];\n});\n`,
    'server/src/f/comment.ts':
      "// models.request({}) and yield* ModelAccess, asides.ask(), HARNESSES\n/* const models = yield* ModelAccess; models.request({}); */\nexport const note = 'models.request({}).text({}) and asides.ask()';\nexport const template = `${'x'} ModelAccess.request`;\n",
    'server/src/f/types.ts':
      "import type { ModelAccess } from '../providers/access';\nimport type { ModelRequest } from '@pkg/modelPort';\nexport type Held = ModelAccess['Service'];\nexport const origin = (request: ModelRequest) => [request.origin, request.rung];\nexport const served = (models: ModelAccess['Service']) => models.served;\n",
    'server/src/f/test-only.test.ts': `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; return models.request({}); });\n`,
  };
  expect(found(files)).toEqual([]);
});

test('the doors themselves may call; the ask door is not a request door, so a request built only to compare origin and rung is still a finding', () => {
  const body = `${HEAD}export const run = Effect.gen(function* () { const models = yield* ModelAccess; const request = models.request({}); return [request.origin, request.rung, yield* request.text({})]; });\n`;
  const files = {
    'server/src/providers/asks.ts': body.replaceAll('../providers/access', './access'),
    'server/src/native/kernel.ts': body,
    'server/src/native/turns.ts': body,
    'server/src/threads/asks.ts': body,
  };
  expect(found(files)).toEqual([
    ['server/src/native/turns.ts', 'request:ModelAccess.request'],
    ['server/src/native/turns.ts', 'request:ModelRequest.text'],
    ['server/src/threads/asks.ts', 'request:ModelAccess.request'],
    ['server/src/threads/asks.ts', 'request:ModelRequest.text'],
  ]);
});

const ASIDES =
  "import { Effect } from 'effect';\nimport { HarnessAsides } from '../threads/asides';\nimport { ThreadAsks } from '../threads/contract/asks';\nimport type { AgentAside, AgentAsideHook } from '@pkg/aside';\n";

test('an aside is asked by its raw ask only in threads/asks.ts, however the aside was reached', () => {
  const files = {
    'server/src/f/service.ts': `${ASIDES}export const go = Effect.gen(function* () { const asides = yield* HarnessAsides; return asides.ask('t', undefined, {}); });\n`,
    'server/src/f/of.ts': `${ASIDES}export const go = Effect.gen(function* () { const asides = yield* HarnessAsides; return asides.of('t')?.ask({ instruction: 'x' }); });\n`,
    'server/src/f/held.ts': `${ASIDES}export const go = Effect.gen(function* () { const asks = yield* ThreadAsks; const held = asks.held('t'); return held?.ask({ instruction: 'x' }); });\n`,
    'server/src/f/typed.ts': `${ASIDES}export const go = (copy: AgentAside) => copy.ask({ instruction: 'x' });\n`,
    'server/src/f/hook.ts': `${ASIDES}export const hook = (id: string): AgentAsideHook => (aside) => aside.ask({ instruction: id });\n`,
    'server/src/f/property.ts': `${ASIDES}type Copy = { readonly ask: AgentAside['ask'] };\nexport const go = (copy: Copy) => copy.ask({ instruction: 'x' });\n`,
    'server/src/f/destructured.ts': `${ASIDES}export const go = ({ ask }: { ask: AgentAside['ask'] }, copy: AgentAside) => { const { ask: again } = copy; return [ask({ instruction: 'x' }), again({ instruction: 'y' }), copy['ask']({ instruction: 'z' })]; };\n`,
    'server/src/threads/asks.ts': `${ASIDES}export const go = Effect.gen(function* () { const asides = yield* HarnessAsides; return asides.ask('t', undefined, {}); });\n`,
  };
  expect(found(files)).toEqual([
    ['server/src/f/destructured.ts', 'ask:AgentAside.ask'],
    ['server/src/f/held.ts', 'ask:AgentAside.ask'],
    ['server/src/f/hook.ts', 'ask:AgentAside.ask'],
    ['server/src/f/of.ts', 'ask:AgentAside.ask'],
    ['server/src/f/property.ts', 'ask:AgentAside.ask'],
    ['server/src/f/service.ts', 'ask:ThreadAsides.ask'],
    ['server/src/f/typed.ts', 'ask:AgentAside.ask'],
  ]);
});

test('providing, watching, holding, forgetting and asking over a thread are not asking an aside', () => {
  const files = {
    'server/src/f/lifecycle.ts': `${ASIDES}export const go = (copy: AgentAside) => Effect.gen(function* () {\n  const asides = yield* HarnessAsides;\n  const asks = yield* ThreadAsks;\n  asides.watch({ opened: () => Effect.void });\n  yield* asides.hold('t', copy);\n  yield* asides.opened('t', 'r', false);\n  yield* asides.forget('t');\n  const held = asks.held('t');\n  const copied = held?.ask;\n  return [held?.expiresAt, held?.source, copied];\n});\n`,
    'server/src/f/door.ts': `${ASIDES}export const go = Effect.gen(function* () { const asks = yield* ThreadAsks; return (asks as { over(id: string, text: string): unknown }).over('t', 'summarize'); });\n`,
  };
  expect(found(files)).toEqual([]);
});

const ROWS = "import { Effect } from 'effect';\nimport { HarnessAdapters } from '../harness/adapters';\n";

test('a vendor harness row is read through its table, rows, service or type only in the harness modules', () => {
  const files = {
    'server/src/f/table.ts':
      "import { HARNESSES, harnessAdapter } from '../harness/table';\nexport const all = HARNESSES.map((row) => row.binary);\nexport const one = harnessAdapter('claude').binary;\n",
    'server/src/f/namespace.ts':
      "import * as table from '../harness/table';\nexport const one = table.harnessAdapter('claude').binary;\nexport const all = table.HARNESSES.length;\n",
    'server/src/f/vendor.ts': "import { claude } from '../harness/vendors/claude/row';\nexport const binary = claude.binary;\n",
    'server/src/f/service.ts': `${ROWS}export const go = Effect.gen(function* () { const adapters = yield* HarnessAdapters; return [adapters.all(), adapters.find('x'), adapters.row('x')]; });\n`,
    'server/src/f/type.ts':
      "import type { HarnessAdapter } from '../harness/adapter';\nexport const binary = (row: HarnessAdapter) => row.binary;\n",
    'server/src/harness/inside.ts': "import { HARNESSES } from './table';\nexport const all = HARNESSES.map((row) => row.binary);\n",
    'server/src/threads/harness/inside.ts':
      "import { harnessAdapter } from '../../harness/table';\nexport const one = harnessAdapter('claude');\n",
  };
  expect(found(files)).toEqual([
    ['server/src/f/namespace.ts', 'row:harness row'],
    ['server/src/f/namespace.ts', 'row:harness row HARNESSES'],
    ['server/src/f/service.ts', 'row:HarnessAdapters.all'],
    ['server/src/f/service.ts', 'row:HarnessAdapters.find'],
    ['server/src/f/service.ts', 'row:HarnessAdapters.row'],
    ['server/src/f/table.ts', 'row:harness row'],
    ['server/src/f/table.ts', 'row:harness row HARNESSES'],
    ['server/src/f/type.ts', 'row:harness row HarnessAdapter'],
    ['server/src/f/vendor.ts', 'row:harness row claude'],
  ]);
});

test('a thread facet named row, publication of rows and an unused type import are not row reads', () => {
  const files = {
    'server/src/f/facet.ts':
      "import { Effect } from 'effect';\nimport { Harness } from '../threads/harness-contract';\nexport const go = Effect.gen(function* () { const harness = yield* Harness; return harness.row('thread'); });\n",
    'server/src/f/publish.ts': `${ROWS}export const go = (providers: readonly string[]) => Effect.gen(function* () { const adapters = yield* HarnessAdapters; yield* adapters.declared(providers); return adapters.changes; });\n`,
    'server/src/f/unused.ts':
      "import type { HarnessAdapter } from '../harness/adapter';\nexport type { HarnessAdapter };\nexport const none = 1;\n",
    'server/src/f/provide.ts': `${ROWS}import { Layer } from 'effect';\nexport const layer = Layer.succeed(HarnessAdapters, { all: () => [] });\n`,
  };
  expect(found(files)).toEqual([]);
});

test('a selected path is judged against unchanged callees without scanning the rest', () => {
  const files = {
    'server/src/providers/helpers.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport const makeRequest = (models: ModelRequester) => models.request({});\n",
    'server/src/f/one.ts':
      "import { makeRequest } from '../providers/helpers';\nimport type { ModelRequester } from '@pkg/modelPort';\nexport const go = (models: ModelRequester) => makeRequest(models).text({});\n",
    'server/src/f/two.ts': `${HEAD}export const run = Effect.gen(function* () { return (yield* ModelAccess).request({}); });\n`,
  };
  expect(found(files, ['server/src/f/one.ts'])).toEqual([['server/src/f/one.ts', 'request:ModelRequest.text']]);
  expect(found(files, ['server/src/f/two.ts', 'server/src/providers/helpers.ts'])).toEqual([
    ['server/src/f/two.ts', 'request:ModelAccess.request'],
  ]);
});

test('a changed helper moves its callers: the frontier follows export capabilities, and stops where they are unchanged', () => {
  const caller =
    "import { makeRequest } from '../providers/helpers';\nimport type { ModelRequester } from '@pkg/modelPort';\nexport const go = (models: ModelRequester) => makeRequest(models).text({});\n";
  const bystander = "import { count } from '../providers/count';\nexport const go = () => count();\n";
  const before = worldOf({
    'server/src/providers/helpers.ts':
      "import type { ModelRequester } from '@pkg/modelPort';\nexport const makeRequest = (models: ModelRequester) => models.request({});\n",
    'server/src/providers/count.ts': 'export const count = () => 1;\n',
    'server/src/f/caller.ts': caller,
    'server/src/f/bystander.ts': bystander,
  });
  const after = worldOf({
    'server/src/providers/helpers.ts': 'export const makeRequest = (models: unknown) => String(models);\n',
    'server/src/providers/count.ts': 'export const count = () => 2;\n',
    'server/src/f/caller.ts': caller,
    'server/src/f/bystander.ts': bystander,
  });
  const importers = (path: string): readonly string[] =>
    ({ 'server/src/providers/helpers.ts': ['server/src/f/caller.ts'], 'server/src/providers/count.ts': ['server/src/f/bystander.ts'] })[
      path
    ] ?? [];
  expect(exportSummary(before, params, 'server/src/providers/helpers.ts')).not.toBe(
    exportSummary(after, params, 'server/src/providers/helpers.ts'),
  );
  expect([...callFrontier(before, after, params, ['server/src/providers/helpers.ts'], importers)].sort()).toEqual([
    'server/src/f/caller.ts',
    'server/src/providers/helpers.ts',
  ]);
  expect(callFrontier(before, after, params, ['server/src/providers/count.ts'], importers)).toEqual(['server/src/providers/count.ts']);
  expect(callFindings(before, params, ['server/src/f/caller.ts']).length).toBe(1);
  expect(callFindings(after, params, ['server/src/f/caller.ts']).length).toBe(0);
});
