import { expect, test } from 'bun:test';
import type { Tree } from '@runlith/code-facts/tree';
import type { InspectionMemo, MemoValue } from '@tagma/inspection/node/memo';
import { checked } from './checks';
import { effectStyle as declared, FORMS, type Form } from './effect-style/declaration';
import { effectStyle } from './effect-style/implementation';

const styleOf = (params: unknown) => checked(declared.params, effectStyle, params);

const imports = "import { Effect, Schema, Scope, Context, Layer, ManagedRuntime, Data } from 'effect';\n";
const params = { base: '', region: ['src/'], files: { extensions: ['.ts', '.svelte'], exclude: ['**/vendor/**'] }, forms: FORMS };
const judge = (
  files: Readonly<Record<string, string>>,
  forms: readonly Form[] = FORMS,
  memo?: InspectionMemo,
  paths: readonly string[] = Object.keys(files),
) => {
  const tree: Tree = {
    has: (path) => Object.hasOwn(files, path),
    read: (path) => files[path]!,
    object: (path) => (Object.hasOwn(files, path) ? Bun.hash(files[path]!).toString(16) : undefined),
    mentions: (words) => new Set(Object.keys(files).filter((path) => words.some((word) => files[path]!.includes(word)))),
  };
  const check = styleOf({ ...params, forms });
  return check.read(tree, paths, [], memo ?? { get: () => undefined, set: () => undefined }, 'reach');
};
const formsOf = (text: string, path = 'src/file.ts') => judge({ [path]: imports + text }).violations.map((one) => one.specifier);

const fixtures: readonly { readonly form: Form; readonly bad: string; readonly good: string; readonly path?: string }[] = [
  { form: 'self-alias', bad: 'class C { m() { const self = this; return self; } }', good: 'const self = other; let receiver = this;' },
  {
    form: 'self-binding',
    bad: 'const work = Effect.gen({ self: this }, function* () { return 1; });',
    good: 'const work = Effect.gen({ other: this }, function* () { return 1; });',
  },
  {
    form: 'service-class',
    bad: 'class Store implements Context.Service.Shape<typeof Tag> {}',
    good: 'class Store implements Other.Shape<typeof Tag> {}',
  },
  {
    form: 'service-instance',
    bad: "import { Rows } from './rows'; const layer = Layer.succeed(Tag, new Rows(db));",
    good: 'const layer = Layer.succeed(Tag, Tag.of({ read: () => rows }));',
  },
  {
    form: 'gen-wrapper',
    bad: 'function work() { return Effect.gen(function* () { return 1; }); }',
    good: "const work = Effect.fn('work')(function* () { yield* use(Effect.gen(function* () { return 1; })); });",
  },
  {
    form: 'pipe-after-fn',
    bad: "const work = Effect.fn('work')(function* () { return 1; }).pipe(transform);",
    good: 'const work = Effect.succeed(1).pipe(transform);',
  },
  {
    form: 'throw-in-effect',
    bad: 'const work = Effect.gen(function* () { if (bad) throw new Error(); });',
    good: 'const work = Effect.gen(function* () { const callback = () => { throw new Error(); }; yield* Effect.try({ try: callback, catch: failure }); });',
  },
  {
    form: 'sync-decode-in-effect',
    bad: 'const work = Effect.gen(function* () { return Schema.decodeUnknownSync(schema)(input); });',
    good: 'const work = Effect.gen(function* () { const callback = () => Schema.decodeUnknownSync(schema)(input); yield* Effect.try({ try: callback, catch: failure }); });',
  },
  {
    form: 'clock-bypass',
    bad: 'const work = Effect.gen(function* () { const at = Date.now(); });',
    good: 'const outside = Date.now(); const work = Effect.gen(function* () { const fixed = new Date(0); const later = Effect.sleep(1); });',
  },
  { form: 'scope-run-sync', bad: 'const scope = Effect.runSync(Scope.make());', good: 'const scope = Effect.runSync(other());' },
  {
    form: 'schema-tagged-error',
    bad: "class Failed extends Schema.TaggedError<Failed>()('Failed', {}) {}",
    good: "class Failed extends Data.TaggedError('Failed') {}",
  },
  {
    form: 'native-tagged-error',
    bad: "class Failed extends Error { readonly _tag = 'Failed'; }",
    good: "class Failed extends Data.TaggedError('Failed') {} class Defect extends Error {}",
  },
  {
    form: 'test-runner',
    bad: 'const answer = Effect.runPromise(work);',
    good: 'it.effect("works", () => Effect.succeed(1));',
    path: 'src/file.test.ts',
  },
];

for (const fixture of fixtures) {
  test(`${fixture.form} distinguishes the prohibited form from its allowed neighbour`, () => {
    expect(formsOf(fixture.bad, fixture.path)).toEqual([fixture.form]);
    expect(formsOf(fixture.good, fixture.path)).toEqual([]);
  });
}

test('native tagged errors are judged without Effect imports and respect field and global binding boundaries', () => {
  const findings = judge(
    {
      'src/native.ts':
        "class Failed extends TypeError { readonly ['_tag'] = 'Failed'; } const Bad = class extends globalThis.Error { _tag = 'Bad'; }; class Defaulted extends Error { constructor(readonly _tag: 'Defaulted' = 'Defaulted') { super(); } } class Public extends TypeError { constructor(public readonly _tag: 'Public') { super(); } }",
      'src/shadow.ts':
        "import { Error } from 'other'; class Local extends Error { _tag = 'Local'; } function local(TypeError) { class Local extends TypeError { _tag = 'Local'; } }",
      'src/allowed.ts':
        "class Defect extends Error {} class Static extends Error { static _tag = 'Static'; } const key = '_tag'; class Computed extends Error { [key] = 'Computed'; } class Argument extends Error { constructor(_tag: string) { super(); } }",
    },
    ['native-tagged-error'],
  ).violations;
  expect(findings.map((one) => [one.file, one.specifier])).toEqual([
    ['src/native.ts', 'native-tagged-error'],
    ['src/native.ts', 'native-tagged-error'],
    ['src/native.ts', 'native-tagged-error'],
    ['src/native.ts', 'native-tagged-error'],
  ]);
});

test('all generator entry forms judge direct throws and sync decoders, and nested functions reset the boundary', () => {
  const calls = ['Effect.gen', "Effect.fn('work')", 'Effect.fn', 'Effect.fnUntraced'];
  for (const call of calls) {
    expect(
      formsOf(
        `const work = ${call}(function* () { throw failure; Schema.decodeSync(schema)(input); Schema.decodeFooSync(schema)(input); function nested() { throw other; } const arrow = () => Schema.decodeUnknownSync(schema)(input); });`,
      ),
    ).toEqual(['throw-in-effect', 'sync-decode-in-effect', 'sync-decode-in-effect']);
  }
  expect(formsOf('const ordinary = function* () { throw failure; Schema.decodeSync(schema)(input); };')).toEqual([]);
  expect(formsOf('const work = Effect.gen(function* () { const nested = Effect.gen(function* () { throw failure; }); });')).toEqual([
    'throw-in-effect',
  ]);
});

test('clock-bypass judges time and waits in generators and their sync callbacks, never outside or in nested functions', () => {
  const clock = (text: string) => formsOf(text).filter((one) => one === 'clock-bypass');
  expect(
    clock(
      "const work = Effect.fn('work')(function* () { Date.now(); new Date(); setTimeout(tick, 1); Promise.race([a, b]); Bun.sleep(1); globalThis.setTimeout(tick, 1); });",
    ),
  ).toHaveLength(6);
  expect(
    clock(
      'const work = Effect.gen(function* () { yield* Effect.sync(() => Date.now()); yield* Effect.try({ try: () => new Date(), catch: failure }); yield* Effect.tryPromise({ try: async () => Bun.sleep(1), catch: failure }); });',
    ),
  ).toHaveLength(3);
  expect(
    clock(
      'const work = Effect.gen(function* () { Date.now(); const nested = () => Date.now(); yield* Effect.sync(function () { return () => Date.now(); }); function inner() { return new Date(); } });',
    ),
  ).toHaveLength(1);
  expect(
    clock('const a = Effect.sync(() => Date.now()); const b = () => setTimeout(tick, 1); const c = function* () { Date.now(); };'),
  ).toEqual([]);
  expect(
    clock(
      'const work = Effect.gen(function* (Date, setTimeout) { Date.now(); setTimeout(tick, 1); new Date(); const Bun = other; Bun.sleep(1); });',
    ),
  ).toEqual([]);
});

test('self binding on named functions, untraced pipes and complete wrapper bodies are judged', () => {
  expect(formsOf("const work = Effect.fn('work')({ self: this }, function* () {});")).toEqual(['self-binding']);
  expect(formsOf('const work = Effect.fnUntraced(function* () {}).pipe(transform);')).toEqual(['pipe-after-fn']);
  expect(formsOf('const work = () => Effect.gen(function* () {});')).toEqual(['gen-wrapper']);
  expect(formsOf('class C { m() { return Effect.gen(function* () {}); } }')).toEqual(['gen-wrapper']);
  expect(formsOf('function work() { prepare(); return Effect.gen(function* () {}); }')).toEqual([]);
  expect(formsOf('const work = Effect.fnUntraced(function* () {}, transform);')).toEqual([]);
});

test('gen wrappers retain their verdict through pipes while inline callbacks and other receivers stay allowed', () => {
  for (const code of [
    "const work = () => Effect.gen(function* () { return 1; }).pipe(Effect.withSpan('work'));",
    'function work() { return (Effect.gen(function* () {}) as Work).pipe(first).pipe(second); }',
    'class C { work() { return Effect.gen(function* () {}).pipe(transform); } }',
    "import { Effect as E } from 'effect'; const work = () => E.gen(function* () {}).pipe(transform);",
  ])
    expect(formsOf(code)).toEqual(['gen-wrapper']);
  expect(formsOf('use(() => Effect.gen(function* () {}).pipe(transform));')).toEqual([]);
  expect(formsOf('const work = () => other.gen(function* () {}).pipe(transform);')).toEqual([]);
  expect(formsOf('function work(Effect) { return Effect.gen(function* () {}).pipe(transform); }')).toEqual([]);
});

test('service-instance follows a class instance through constants, layer effects and tag constructors to the tag it fills', () => {
  const instance = (text: string) => formsOf(`import { Rows } from './rows'; ${text}`).filter((one) => one === 'service-instance');
  for (const code of [
    'const fill = Layer.effectContext(Effect.gen(function* () { const rows = new Rows(yield* Db); return Context.make(Tag, rows); }));',
    'const fill = Layer.effectContext(Effect.gen(function* () { return Context.make(First, first).pipe(Context.add(Tag, new Rows())); }));',
    'const fill = Layer.effect(Tag, Effect.gen(function* () { return new Rows(yield* Db); }));',
    'const make = Effect.gen(function* () { return Tag.of(new Rows()); }); const fill = Layer.effect(Tag, make);',
    'const fill = Layer.sync(Tag, () => (ready ? new Rows() : fallback));',
    'const filled = Context.add(context, Tag, new Rows());',
    'const makeRows = () => new Rows(); const fill = Layer.effect(Tag, Effect.sync(makeRows));',
    'function makeRows() { return new Rows(); } const fill = Layer.sync(Tag, makeRows);',
    'const makeRows = Effect.fnUntraced(function* () { return new Rows(); }); const fill = Layer.effect(Tag, makeRows());',
    'const fill = Layer.succeed(Tag)(new Rows());',
    'const fill = Layer.sync(Tag)(() => new Rows());',
    'const fill = Layer.effect(Tag)(Effect.succeed(new Rows()));',
  ])
    expect(instance(code)).toEqual(['service-instance']);
  for (const code of [
    'const fill = Layer.effect(Tag, Effect.gen(function* () { const rows = new Rows(); return Tag.of({ read: (id) => rows.read(id) }); }));',
    'const fill = Layer.effect(Tag, makeRows);',
    'const fill = Layer.succeed(Tag, new Map());',
    'function fill(rows) { return Layer.succeed(Tag, rows); }',
    'const fill = Layer.effect(Tag, Effect.gen(function* () { const make = () => new Rows(); return Tag.of({ make }); }));',
    'const fill = Layer.succeed(Factory, () => new Rows());',
    'const fill = Layer.effect(Factory, Effect.succeed(() => new Rows()));',
    'const fill = Layer.effect(Factory, Effect.gen(function* () { return () => new Rows(); }));',
    'const fill = Layer.succeed(RowsTag, Array.of(new Rows()));',
  ])
    expect(instance(code)).toEqual([]);
  const module = "<script module>import { Context } from 'effect'; import { Rows } from './rows'; const rows = new Rows();</script>";
  const forms = judge({ 'src/Component.svelte': `${module}<script>const filled = Context.make(Tag, rows);</script>` }).violations;
  expect(forms.map((one) => one.specifier)).toEqual(['service-instance']);
});

test('Reference data provisions remain allowed while Service implementations are judged through the same aliases and builders', () => {
  const data = 'class Invocation {} const at = new Invocation();';
  const reference = "const Current = Context.Reference<Invocation>('Current', { defaultValue: () => new Invocation() });";
  const service = "class Current extends Context.Service<Current, Invocation>()('Current') {}";
  const provisions = [
    'Layer.succeed(Tag, at)',
    'Layer.effect(Tag, Effect.succeed(at))',
    'Layer.sync(Tag)(() => Tag.of(at))',
    'Context.make(Tag, at)',
    'Context.add(context, Tag, at)',
  ].join(';');
  for (const [tag, count] of [
    [reference, 0],
    [service, 5],
  ] as const) {
    const verdict = judge({ 'src/file.ts': imports + data + tag + `const Tag = Current; ${provisions};` }, ['service-instance']);
    expect(verdict.violations.map((one) => one.specifier)).toEqual(Array(count).fill('service-instance'));
    expect(verdict.unjudged).toEqual([]);
  }
  expect(formsOf(data + reference + 'function fill(Current) { return Layer.succeed(Current, at); }')).toEqual(['service-instance']);
  expect(
    formsOf("import { Context as C } from 'other';" + data + reference.replace('Context.', 'C.') + 'Layer.succeed(Current, at);'),
  ).toEqual(['service-instance']);
});

test('imported Reference classification follows exported aliases and namespaces and invalidates memo when only the declaration changes', () => {
  const held = new Map<string, MemoValue>();
  const memo: InspectionMemo = {
    get: (key) => held.get(key),
    set: (key, value) => {
      held.set(key, value);
    },
  };
  const path = 'src/consumer.ts';
  const consumer =
    imports +
    "import { Current as Named } from './tag.js'; import * as Tags from './tag'; class Value {} const at = new Value(); Layer.succeed(Named, at); Context.make(Tags.Current, at);";
  const reference =
    "import * as C from 'effect/Context'; const Local = C.Reference<Value>('Current', { defaultValue: () => new Value() }); export { Local as Current };";
  const service = "import { Context } from 'effect'; export class Current extends Context.Service<Current, Value>()('Current') {}";
  const read = (tag: string | undefined) =>
    judge(tag === undefined ? { [path]: consumer } : { [path]: consumer, 'src/tag.ts': tag }, ['service-instance'], memo, [path]);
  for (const [tag, expected] of [
    [undefined, 2],
    [reference, 0],
    [service, 2],
    [reference, 0],
  ] as const) {
    const verdict = read(tag);
    expect(verdict.violations.map((one) => one.specifier)).toEqual(Array(expected).fill('service-instance'));
    expect(verdict.unjudged).toEqual([]);
  }
  const first = read(service).violations.map((one) => one.fingerprint);
  expect(read(service + '\nconst unrelated = 1;').violations.map((one) => one.fingerprint)).toEqual(first);
});

test('service implements follows local indexed service aliases and respects local alias shadows', () => {
  expect(formsOf("type Shape = Tag['Service']; type Port = Shape & Other; class Store implements Port {}")).toEqual(['service-class']);
  expect(formsOf("type Shape = Tag['Other']; class Store implements Shape {}")).toEqual([]);
  expect(formsOf("type Shape = Tag['Service']; function local() { type Shape = Other; class Store implements Shape {} }")).toEqual([]);
  expect(formsOf('type A = B; type B = A; class Store implements A {}')).toEqual([]);
});

test('imports resolve named aliases, root namespaces, module namespaces and type-only Context', () => {
  const files = {
    'src/alias.ts':
      "import { Effect as E, Schema as S, Scope as Sc, ManagedRuntime as M } from 'effect'; import type { Context as C } from 'effect'; class Store implements C.Service.Shape<typeof Tag> {} const work = E.fnUntraced(function* () { throw failure; S.decodeSync(schema)(input); }); const scope = E.runSync(Sc.make());",
    'src/root.itest.ts':
      "import * as Fx from 'effect'; const work = Fx.Effect.gen({ self: this }, function* () {}); class Failed extends Fx.Schema.TaggedError()('Failed', {}) {} Fx.ManagedRuntime.make(layer);",
    'src/module.ts': "import * as E from 'effect/Effect'; E.gen(function* () { throw failure; });",
  };
  expect(judge(files).violations.map((one) => one.specifier)).toEqual([
    'service-class',
    'throw-in-effect',
    'sync-decode-in-effect',
    'scope-run-sync',
    'throw-in-effect',
    'self-binding',
    'schema-tagged-error',
    'test-runner',
  ]);
});

test('local objects, foreign imports, type-only values and lexical shadows do not become Effect receivers', () => {
  const files = {
    'src/local.test.ts': 'const Effect = local; Effect.runPromise(work); Effect.gen(function* () { throw failure; });',
    'src/foreign.ts': "import { Effect } from 'other'; Effect.gen(function* () { throw failure; });",
    'src/types.ts': "import type { Effect } from 'effect'; Effect.gen(function* () { throw failure; });",
    'src/shadow.test.ts':
      imports +
      'function local(Effect, Schema, Scope, Context, ManagedRuntime) { type Context = Other; Effect.runSync(Scope.make()); Effect.gen(function* () { throw failure; Schema.decodeSync(schema)(input); }); ManagedRuntime.make(layer); class Store implements Context.Service.Shape<Tag> {} } { const Effect = local; Effect.runPromise(work); } function later() { Effect.runPromise(work); var Effect; } try {} catch (Effect) { Effect.runPromise(work); } for (const Effect of values) { Effect.runPromise(work); }',
  };
  expect(judge(files).violations).toEqual([]);
});

test('runner families are judged in unit, integration, e2e and system files, called, aliased or passed', () => {
  const code =
    imports +
    'Effect.runPromiseExit(work); Effect.runSyncExit(work); ManagedRuntime.make(layer); const run = Effect.runPromise; await run(work); done.pipe(Effect.runSync);';
  for (const suffix of ['test', 'itest', 'e2e', 'stest']) {
    expect(judge({ [`src/file.${suffix}.ts`]: code }).violations.map((one) => one.specifier)).toEqual([
      'test-runner',
      'test-runner',
      'test-runner',
      'test-runner',
      'test-runner',
    ]);
  }
  expect(judge({ 'src/file.ts': code }).violations).toEqual([]);
});

test('selection respects forms, base, region, extensions and excluded paths', () => {
  const check = styleOf({ ...params, base: 'pkg', forms: ['self-alias'] });
  const files = {
    'pkg/src/file.ts': imports + 'const self = this; Effect.gen(function* () { throw failure; });',
    'src/file.ts': 'const self = this;',
    'pkg/src/vendor/file.ts': 'const self = this;',
    'pkg/src/file.txt': 'const self = this;',
    'pkg/other/file.ts': 'const self = this;',
  };
  const tree: Tree = { has: (path) => Object.hasOwn(files, path), read: (path) => files[path as keyof typeof files] };
  expect(
    check
      .read(tree, Object.keys(files), [], { get: () => undefined, set: () => undefined }, 'change')
      .violations.map((one) => one.specifier),
  ).toEqual(['self-alias']);
  expect(() => styleOf({ ...params, forms: ['unknown'] })).toThrow();
  expect(() => styleOf({ ...params, forms: ['self-alias', 'self-alias'] })).toThrow();
  expect(() => styleOf({ ...params, region: ['src'] })).toThrow();
});

test('fingerprints retain owning declarations across unrelated edits and whitespace and distinguish duplicate sites', () => {
  const code = imports + 'class Store { m() { const self = this; { const self = this; } } }';
  const first = judge({ 'src/file.ts': code }).violations;
  const shifted = judge({ 'src/file.ts': 'const unrelated = 1;\n\n' + code.replaceAll('self = this', 'self  =  this') }).violations;
  expect(shifted.map((one) => one.fingerprint)).toEqual(first.map((one) => one.fingerprint));
  expect(first.map((one) => [one.file, one.line, one.fingerprint.split(' ')[1]])).toEqual([
    ['src/file.ts', 2, 'Store.self'],
    ['src/file.ts', 2, 'Store.self'],
  ]);
  expect(first[1]!.fingerprint).toBe(`${first[0]!.fingerprint}#2`);
  expect(shifted[0]!.line).toBe(4);
  expect(judge({ 'src/file.ts': code.replaceAll('self = this', 'self = (this as Store)') }).violations[0]!.fingerprint).not.toBe(
    first[0]!.fingerprint,
  );
});

test('a site is identified by its form, so edits inside enclosed bodies keep the fingerprint and edits to the form change it', () => {
  const cases = [
    {
      form: 'gen-wrapper',
      at: 'function work(input: A) { return Effect.gen(function* () { return input.old; }); }',
      body: 'function work(input: A) { return Effect.gen(function* () { return input.renamed; }); }',
      shape: 'function work(input: B) { return Effect.gen(function* () { return input.old; }); }',
    },
    {
      form: 'gen-wrapper',
      at: "const work = () => Effect.gen(function* () { return old; }).pipe(Effect.withSpan('work'));",
      body: "const work = () => Effect.gen(function* () { return renamed; }).pipe(Effect.withSpan('work'));",
      shape: "const work = () => Effect.gen(function* () { return old; }).pipe(Effect.withSpan('other'));",
    },
    {
      form: 'pipe-after-fn',
      at: "const work = Effect.fn('work')(function* () { return 1; }).pipe(Effect.mapError((e = made(() => old)) => e.old));",
      body: "const work = Effect.fn('work')(function* () { return 2; }).pipe(Effect.mapError((e = made(() => renamed)) => e.renamed));",
      shape: "const work = Effect.fn('work')(function* () { return 1; }).pipe(Effect.orDie);",
    },
    {
      form: 'schema-tagged-error',
      at: "class Failed extends Schema.TaggedError<Failed>()('Failed', { old: Schema.String }) {}",
      body: "class Failed extends Schema.TaggedError<Failed>()('Failed', { renamed: Schema.String }) {}",
      shape: "class Failed extends Schema.TaggedError<Failed>()('Other', { old: Schema.String }) {}",
    },
    {
      form: 'test-runner',
      at: 'const runtime = ManagedRuntime.make(base.pipe(Layer.provide(First)));',
      body: 'const runtime = ManagedRuntime.make(base.pipe(Layer.provide(First), Layer.provide(Catalogs)));',
      shape: 'const runtime = Effect.runSync(base.pipe(Layer.provide(First)));',
    },
    {
      form: 'test-runner',
      at: 'const answer = Effect.runPromise(Effect.gen(function* () { return yield* old; }));',
      body: 'const answer = Effect.runPromise(Effect.gen(function* () { return yield* renamed; }));',
      shape: 'const answer = Effect.runSync(Effect.gen(function* () { return yield* old; }));',
    },
  ] as const;
  for (const one of cases) {
    const fingerprint = (code: string) => {
      const found = judge({ 'src/file.test.ts': imports + code }, [one.form]).violations;
      expect(found.map((violation) => violation.specifier)).toEqual([one.form]);
      return found[0]!.fingerprint;
    };
    expect(fingerprint(one.body)).toBe(fingerprint(one.at));
    expect(fingerprint(one.shape)).not.toBe(fingerprint(one.at));
  }
});

test('named callbacks retain independent debt identities inside unnamed top-level statements', () => {
  const first = 'register(function first() { Effect.gen({ self: this }, function* () {}); });';
  const second = 'register(function second() { Effect.gen({ self: this }, function* () {}); });';
  const both = judge({ 'src/file.ts': imports + first + second }).violations;
  expect(both.map((one) => one.fingerprint.split(' ')[1])).toEqual(['first', 'second']);
  expect(judge({ 'src/file.ts': imports + second }).violations[0]!.fingerprint).toBe(both[1]!.fingerprint);
});

test('memoized sites serve independent form rules and invalidate when source changes', () => {
  const held = new Map<string, MemoValue>();
  const memo: InspectionMemo = {
    get: (key) => held.get(key),
    set: (key, value) => {
      held.set(key, value);
    },
  };
  const files = { 'src/file.ts': imports + 'const self = this; Effect.gen(function* () { throw failure; });' };
  expect(judge(files, ['self-alias'], memo).violations.map((one) => one.specifier)).toEqual(['self-alias']);
  expect(judge(files, ['throw-in-effect'], memo).violations.map((one) => one.specifier)).toEqual(['throw-in-effect']);
  expect(judge({ 'src/file.ts': imports + 'const self = other;' }, ['self-alias'], memo).violations).toEqual([]);
});

test('type and value declarations resolve in their own namespaces without hiding imported receivers', () => {
  expect(
    formsOf(
      'function work<Effect>() { type Schema = unknown; return Effect.gen(function* () { throw failure; Schema.decodeSync(schema)(input); }); }',
    ),
  ).toEqual(['throw-in-effect', 'sync-decode-in-effect']);
  expect(formsOf('function work<Effect>() { return Effect.gen(function* () { throw failure; }); }')).toEqual([
    'gen-wrapper',
    'throw-in-effect',
  ]);
  expect(formsOf("type Shape = Tag['Service']; function work() { const Shape = other; class Store implements Shape {} }")).toEqual([
    'service-class',
  ]);
  expect(formsOf('function work() { interface Effect {} return Effect.gen(function* () { throw failure; }); }')).toEqual([
    'throw-in-effect',
  ]);
  expect(
    formsOf(
      'class C { static { var Effect = other; Effect.gen(function* () { throw failure; }); } } Effect.gen(function* () { throw failure; });',
    ),
  ).toEqual(['throw-in-effect']);
});

test('Svelte instance scripts inherit module imports and keep instance-local shadows', () => {
  const module = '<script module>import { Effect } from "effect";</script>';
  const instance = '<script>Effect.gen(function* () { throw failure; });</script>';
  expect(judge({ 'src/Component.svelte': module + instance }).violations.map((one) => one.specifier)).toEqual(['throw-in-effect']);
  expect(judge({ 'src/Component.svelte': instance + module }).violations.map((one) => one.specifier)).toEqual(['throw-in-effect']);
  expect(
    judge({ 'src/Component.svelte': module + '<script>const Effect = other; Effect.gen(function* () { throw failure; });</script>' })
      .violations,
  ).toEqual([]);
});

test('inline generator callbacks remain allowed and still judge throws and decoders inside their generators', () => {
  expect(formsOf('it.effect("works", () => Effect.gen(function* () {}));')).toEqual([]);
  expect(formsOf('use((function () { return Effect.gen(function* () {}); }) as Callback);')).toEqual([]);
  expect(formsOf('use(Effect.gen(function* () {}));')).toEqual([]);
  expect(formsOf('use(() => Effect.gen(function* () { throw failure; Schema.decodeSync(schema)(input); }));')).toEqual([
    'throw-in-effect',
    'sync-decode-in-effect',
  ]);
});

test('mention pruning preserves escaped syntactic forms and quoted declarations keep stable memo fingerprints', () => {
  expect(judge({ 'src/escaped.ts': String.raw`const s\u0065lf = this;` }).violations.map((one) => one.specifier)).toEqual(['self-alias']);
  expect(
    judge({
      'src/escaped.ts': String.raw`import { Effect as E } from 'effect'; const work = () => E.g\u0065n(function* () {});`,
    }).violations.map((one) => one.specifier),
  ).toEqual(['gen-wrapper']);
  const held = new Map<string, MemoValue>();
  const memo: InspectionMemo = {
    get: (key) => held.get(key),
    set: (key, value) => {
      held.set(key, value);
    },
  };
  const files = { 'src/file.ts': imports + 'class Store { "two words"() { Effect.gen(function* () { throw failure; }); } }' };
  const first = judge(files, FORMS, memo).violations;
  expect(first.map((one) => one.fingerprint.split(' ')[1])).toEqual(['Store']);
  expect(judge(files, FORMS, memo).violations).toEqual(first);
});

test('Svelte script offsets identify findings and malformed selected source refuses', () => {
  const findings = judge({
    'src/Component.svelte': '<div />\n<script lang="ts">\n' + imports + 'const self = this;\n</script>',
  }).violations;
  expect(findings.map((one) => [one.file, one.line, one.specifier])).toEqual([['src/Component.svelte', 4, 'self-alias']]);
  expect(() => judge({ 'src/broken.ts': imports + 'Effect.gen(;' })).toThrow();
});
