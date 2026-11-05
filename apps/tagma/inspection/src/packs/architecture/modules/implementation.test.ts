import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { overlay, UnsupportedSource } from '@runlith/code-facts/imports';
import type { Tree } from '@runlith/code-facts/tree';
import type { Assembled, Params } from '../../../builtins';
import type { MapModule, ModuleMap } from '../../../core/rule';
import { ASK_BUDGET_MS, budgetOf, deriveCalibration, EnvelopeExceeded, unbounded } from '../../../core/node/budget';
import { inspect, remapped } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { memoWrites, type ReachTable, type ReachView } from '../../../core/node/memo';
import { modules as reading } from './implementation';
import { ready } from '../../../builtins.node';

await ready('modules');

type Drawn = { readonly modules?: readonly MapModule[]; readonly relations?: ModuleMap['relations']; readonly region?: readonly string[] };

const MODULES: readonly MapModule[] = [
  { id: 'core', territory: ['core/'] },
  { id: 'store', territory: ['store/'], entries: [{ at: 'store/contract/' }, { at: 'store/store.ts', for: ['app'] }] },
  { id: 'app', territory: ['app/'] },
  { id: 'cli', territory: ['cli/'] },
];

const RELATIONS: ModuleMap['relations'] = [
  { from: 'store', to: 'core' },
  { from: 'app', to: 'store' },
  { from: 'app', to: 'core' },
  { from: 'cli', to: 'store' },
];

const rooted = (base: string, drawn: Drawn): ModuleMap => {
  const at = (path: string) => (base === '' ? path : `${base}/${path}`);
  return {
    modules: (drawn.modules ?? MODULES).map((one) => ({
      id: one.id,
      territory: [at(one.territory[0]), ...one.territory.slice(1).map(at)],
      entries: one.entries?.map((door) => ({ ...door, at: at(door.at) })),
      order: one.order?.map(([low, ...rest]) => [at(low), ...rest.map(at)] as const),
    })),
    relations: drawn.relations ?? RELATIONS,
    region: (drawn.region ?? ['']).map((one) => (one === '' ? `${base}/` : at(one))),
  };
};

const modules = (change: Partial<Params<'modules'>> = {}, drawn: Drawn = {}): Assembled => {
  const policy: Params<'modules'> = {
    base: 'app/src',
    cycles: 'refuse',
    coverage: 'refuse',
    unresolved: 'refuse',
    reads: 'every',
    conditions: [],
    files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
    ...change,
  };
  return { builtin: 'modules', params: { ...policy, map: rooted(policy.base, drawn) } };
};

const tree = (texts: Record<string, string>, read: (path: string) => void = () => {}): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    read(path);
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: (prefix = '') => Object.keys(texts).filter((path) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`)),
  mentions: (words) => new Set(Object.keys(texts).filter((path) => words.some((word) => texts[path]!.includes(word)))),
});

const store = {
  'app/src/store/contract/x.ts': 'export const x = 1;\n',
  'app/src/store/store.ts': 'export const s = 1;\n',
  'app/src/store/internal.ts': 'export const i = 1;\n',
  'app/src/core/model.ts': 'export const m = 1;\n',
};

const prints = (violations: readonly { readonly fingerprint: string }[]) => violations.map(({ fingerprint }) => fingerprint).sort();

describe('modules: reading a tree', () => {
  it('treats declared virtual framework imports as external while judging authored aliases and unresolved names outside the declaration', () => {
    const texts = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '$app/owned': ['./app/src/store/internal.ts'], '$lib/*': ['./app/src/store/*'] } },
      }),
      ...store,
      'app/src/app/main.ts':
        "import { goto } from '$app/navigation';\nimport { page } from '$app/state';\nimport { i } from '$app/owned';\nimport { missing } from '$lib/typo';\nimport root from '$app';\nimport near from '$application/state';\nimport env from '$env/static/public';\nimport privateEnv from '$env/static/private';\nimport type { Load } from './$types';\nimport type { Typo } from './$typo';\n",
    };
    const inspection = modules({ framework: ['$app/*', '$env/static/public', './$types'] });
    const result = inspect(inspection, tree(texts), ['app/src/app/main.ts'], unbounded());
    expect(prints(result.violations)).toEqual([
      'app -> $app unresolved @ app/main.ts',
      'app -> $application/state unresolved @ app/main.ts',
      'app -> $env/static/private unresolved @ app/main.ts',
      'app -> $lib/typo unresolved @ app/main.ts',
      'app -> ./$typo unresolved @ app/main.ts',
      'app -> store private @ app/main.ts',
    ]);
    expect(result.unjudged).toEqual([]);
  });

  it('judges an import carrying a declared query at the file it names, and keeps an undeclared query unresolved', () => {
    const texts = {
      'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '$lib/*': ['./app/src/store/*'] } } }),
      ...store,
      'app/src/store/cursor.svg': '<svg/>\n',
      'app/src/app/main.ts': "import raw from '../store/cursor.svg?raw';\nimport url from '../store/cursor.svg?url';\n",
      'app/src/cli/main.ts': "import raw from '$lib/cursor.svg?raw';\n",
    };
    const read = inspect(modules({ queries: ['?raw'] }), tree(texts), ['app/src/app/main.ts', 'app/src/cli/main.ts'], unbounded());
    expect(prints(read.violations)).toEqual([
      'app -> ../store/cursor.svg?url unresolved @ app/main.ts',
      'app -> store private @ app/main.ts',
      'cli -> store private @ cli/main.ts',
    ]);
    expect(read.unjudged).toEqual([]);
  });

  it('judges built package entries through tracked sources, retaining private-entry and missing-source refusals', () => {
    const inspection = modules(
      {
        base: '',
        built: [
          {
            output: 'libs/kit/dist/public.js',
            source: 'libs/kit/src/contract/public.ts',
            why: 'The committed contract is the compiled entry source.',
          },
          {
            output: 'libs/kit/dist/private.js',
            source: 'libs/kit/src/private.ts',
            why: 'The compiled private entry keeps its source boundary.',
          },
        ],
      },
      {
        modules: [
          { id: 'app', territory: ['app/'] },
          { id: 'kit', territory: ['libs/kit/'], entries: [{ at: 'libs/kit/src/contract/' }] },
        ],
        relations: [{ from: 'app', to: 'kit' }],
        region: ['app/', 'libs/'],
      },
    );
    const texts = {
      'package.json': JSON.stringify({ workspaces: ['libs/*'] }),
      'libs/kit/package.json': JSON.stringify({
        name: 'kit',
        exports: { './public': './dist/public.js', './private': './dist/private.js', './missing': './dist/missing.js' },
      }),
      'libs/kit/src/contract/public.ts': 'export const publicValue = 1;',
      'libs/kit/src/private.ts': 'export const privateValue = 2;',
      'app/main.ts':
        "import { publicValue } from 'kit/public';\nimport { privateValue } from 'kit/private';\nimport missing from 'kit/missing';\n",
    };
    const expected = ['app -> kit private @ app/main.ts', 'app -> kit/missing unresolved @ app/main.ts'];
    expect(prints(inspect(inspection, tree(texts), ['app/main.ts'], unbounded()).violations)).toEqual(expected);
    expect(
      prints(
        inspect(inspection, tree({ ...texts, 'libs/kit/dist/public.js': '', 'libs/kit/dist/private.js': '' }), ['app/main.ts'], unbounded())
          .violations,
      ),
    ).toEqual(expected);
    const { 'libs/kit/src/contract/public.ts': _removed, ...missing } = texts;
    expect(prints(inspect(inspection, tree(missing), ['app/main.ts'], unbounded()).violations)).toEqual([
      ...expected,
      'app -> kit/public unresolved @ app/main.ts',
    ]);
  });

  describe('a config extending a file the build generates', () => {
    const generated = (built?: Params<'modules'>['built']) =>
      modules(
        { base: '', built },
        {
          modules: [
            { id: 'routes', territory: ['app/src/routes/'] },
            { id: 'store', territory: ['app/src/lib/store/'], entries: [{ at: 'app/src/lib/store/contract/' }] },
          ],
          relations: [{ from: 'routes', to: 'store' }],
          region: ['app/'],
        },
      );
    const copy = generated([
      { output: 'app/.gen/tsconfig.json', source: 'app/gen.json', why: 'The committed copy of the generated config.' },
    ]);
    const aliased = (target: string) => JSON.stringify({ compilerOptions: { paths: { '$lib/*': [target] } } });
    const texts = {
      'app/tsconfig.json': JSON.stringify({ extends: './.gen/tsconfig.json' }),
      'app/gen.json': aliased('../src/lib/*'),
      'app/src/lib/store/contract/x.ts': 'export const x = 1;\n',
      'app/src/lib/store/View.svelte': '<p>store</p>\n',
      'app/src/routes/page.ts': "import { x } from '$lib/store/contract/x';\nimport View from '$lib/store/View.svelte';\n",
    };
    const page = ['app/src/routes/page.ts'];
    const refusal = (inspection: Assembled, judged: Tree): unknown => {
      try {
        inspect(inspection, judged, page, unbounded());
      } catch (error) {
        return error;
      }
      return undefined;
    };

    it('is read as its declared tracked copy, and without one refuses naming the missing file', () => {
      expect(prints(inspect(copy, tree(texts), page, unbounded()).violations)).toEqual([
        'routes -> store private @ app/src/routes/page.ts',
      ]);
      expect(refusal(generated(), tree(texts))).toMatchObject({ path: 'app/tsconfig.json', absent: 'app/.gen/tsconfig.json' });
      const unsuffixed = { ...texts, 'app/tsconfig.json': JSON.stringify({ extends: './.gen/tsconfig' }) };
      expect(refusal(generated(), tree(unsuffixed))).toMatchObject({ path: 'app/tsconfig.json', absent: 'app/.gen/tsconfig.json' });
      expect(prints(inspect(copy, tree(unsuffixed), page, unbounded()).violations)).toEqual([
        'routes -> store private @ app/src/routes/page.ts',
      ]);
      const { 'app/gen.json': copied, ...uncopied } = texts;
      expect(refusal(copy, tree(uncopied))).toMatchObject({ path: 'app/tsconfig.json', absent: 'app/gen.json' });
      const unwatched = generated([{ output: 'app/.gen/tsconfig.json', source: 'app/gen.jsonc', why: 'A copy no config watch names.' }]);
      expect(refusal(unwatched, tree({ ...uncopied, 'app/gen.jsonc': copied }))).toMatchObject({ path: 'app/gen.jsonc' });
    });

    it('refuses a copy the generated file of the checkout contradicts, naming both, and reads one saying the same in another form', () => {
      const checkout = (generatedText: string): Tree => ({
        ...tree(texts),
        working: (path) => (path === 'app/.gen/tsconfig.json' ? generatedText : undefined),
      });
      const reformatted = JSON.stringify(JSON.parse(texts['app/gen.json']), null, '\t');
      expect(prints(inspect(copy, checkout(reformatted), page, unbounded()).violations)).toEqual([
        'routes -> store private @ app/src/routes/page.ts',
      ]);
      expect(refusal(copy, checkout(aliased('../src/kit/*')))).toMatchObject({ path: 'app/gen.json', output: 'app/.gen/tsconfig.json' });
      const ranked = (...keys: string[]) =>
        JSON.stringify({ compilerOptions: { paths: Object.fromEntries(keys.map((key) => [key, ['../src/lib/*']])) } });
      const first: Tree = {
        ...tree({ ...texts, 'app/gen.json': ranked('$lib/*', '$lib/*/x') }),
        working: (path) => (path === 'app/.gen/tsconfig.json' ? ranked('$lib/*/x', '$lib/*') : undefined),
      };
      expect(refusal(copy, first)).toMatchObject({ path: 'app/gen.json', output: 'app/.gen/tsconfig.json' });
      const { 'app/tsconfig.json': _config, ...unconfigured } = texts;
      const nearest = generated([
        { output: 'app/tsconfig.json', source: 'app/config.json', why: 'The committed copy of the generated config.' },
      ]);
      const generatedConfig: Tree = {
        ...tree({ ...unconfigured, 'app/config.json': texts['app/gen.json'] }),
        working: (path) => (path === 'app/tsconfig.json' ? aliased('../src/kit/*') : undefined),
      };
      expect(refusal(nearest, generatedConfig)).toMatchObject({ path: 'app/config.json', output: 'app/tsconfig.json' });
    });

    it('judges again the files that read through the copy when a change edits it', () => {
      const lib = {
        'app/tsconfig.json': texts['app/tsconfig.json'],
        'app/src/lib/store/contract/x.ts': texts['app/src/lib/store/contract/x.ts'],
        'app/src/lib/store/x.ts': 'export const x = 2;\n',
        'app/src/routes/page.ts': "import { x } from '$lib/x';\n",
      };
      const change = {
        base: tree({ ...lib, 'app/gen.json': aliased('../src/lib/store/contract/*') }),
        built: tree({ ...lib, 'app/gen.json': aliased('../src/lib/store/*') }),
        paths: ['app/gen.json'],
      };
      expect(prints(judge(copy, change, [], unbounded()).violations)).toEqual(['routes -> store private @ app/src/routes/page.ts']);
    });

    it('reads a declared copy in place of an installed package config its link leads elsewhere, and refuses the copy the installed file contradicts', () => {
      const output = 'node_modules/@acme/tsconfig/base.json';
      const copied = aliased('../../../app/src/lib/*');
      const stored = (installedText: string): Tree => {
        const installed: Record<string, string> = {
          'node_modules/@acme/tsconfig/package.json': JSON.stringify({ name: '@acme/tsconfig' }),
          [output]: installedText,
        };
        const link = 'node_modules/@acme/tsconfig';
        const store = 'node_modules/.store/acme/node_modules/@acme/tsconfig';
        const read = (path: string) => {
          const linked = path.startsWith(store) ? `${link}${path.slice(store.length)}` : path;
          const text = installed[linked];
          return text === undefined ? undefined : { text, at: linked.startsWith(link) ? `${store}${linked.slice(link.length)}` : linked };
        };
        return {
          ...tree({ ...texts, 'app/tsconfig.json': JSON.stringify({ extends: '@acme/tsconfig/base.json' }), 'app/cfg.json': copied }),
          environment: { depth: 0, read },
          working: (path) => read(path)?.text,
        };
      };
      const declared = generated([{ output, source: 'app/cfg.json', why: 'The committed copy of the installed base config.' }]);
      expect(prints(inspect(declared, stored(copied), page, unbounded()).violations)).toEqual([
        'routes -> store private @ app/src/routes/page.ts',
      ]);
      expect(refusal(declared, stored(aliased('../../../app/src/kit/*')))).toMatchObject({ path: 'app/cfg.json', output });
    });

    it('re-resolves the files that read an installed package config once a reinstall changes it, before the importer index serves them', () => {
      const aliasedIn = (target: string) => JSON.stringify({ compilerOptions: { paths: { '$lib/*': [`\${configDir}/${target}`] } } });
      let installed: Record<string, string> = {
        'node_modules/@acme/tsconfig/package.json': JSON.stringify({ name: '@acme/tsconfig' }),
        'node_modules/@acme/tsconfig/base.json': aliasedIn('src/lib/store/contract/*'),
      };
      const lib = {
        'app/src/lib/store/contract/x.ts': texts['app/src/lib/store/contract/x.ts'],
        'app/src/lib/store/x.ts': 'export const x = 2;\n',
        'app/src/routes/page.ts': "import { x } from '$lib/x';\n",
      };
      const side = (options: object, snapshot: string): Tree => ({
        ...tree({ ...lib, 'app/tsconfig.json': JSON.stringify({ extends: '@acme/tsconfig/base.json', compilerOptions: options }) }),
        snapshot,
        slot: 'checkout',
        environment: { depth: 0, read: (path) => (installed[path] === undefined ? undefined : { text: installed[path]!, at: path }) },
      });
      const views = new Map<string, ReachView<unknown, unknown>>();
      const empty = { head: undefined, members: undefined, node: () => undefined, sources: () => [], watchers: () => [] };
      const table: ReachTable = {
        open: <N, M>(key: string) => (views.get(key) ?? empty) as ReachView<N, M>,
        apply: (key, _from, to, delta, members) => {
          const before = views.get(key) ?? empty;
          views.set(key, { ...overlay(before, delta), head: { tree: to, generation: (before.head?.generation ?? 0) + 1 }, members });
          return 'applied';
        },
      };
      const judged = (base: Tree, built: Tree) => {
        const memo = memoWrites(new Map(), table);
        const verdict = judge(generated(), { base, built, paths: ['app/tsconfig.json'] }, [], unbounded(), ADAPTERS, memo);
        memo.commit();
        return prints(verdict.violations);
      };
      const strict = side({ strict: true }, 'strict');
      expect(judged(side({}, 'plain'), strict)).toEqual([]);
      installed = { ...installed, 'node_modules/@acme/tsconfig/base.json': aliasedIn('src/lib/store/*') };
      expect(judged(strict, side({ strict: true, noEmit: true }, 'quiet'))).toEqual([]);
      expect(prints(inspect(generated(), strict, page, unbounded()).violations)).toEqual([
        'routes -> store private @ app/src/routes/page.ts',
      ]);
    });
  });

  it('names an import no relation allows, one that reaches no entry open to its consumer, one landing on a path nobody owns, an unresolved one and an uncovered file, and nothing else', () => {
    const texts = {
      ...store,
      'app/src/core/peek.ts': "import { x } from '../store/contract/x';\n",
      'app/src/app/main.ts':
        "import { x } from '../store/contract/x';\nimport { s } from '../store/store';\nimport { m } from '../core/model';\nimport { i } from '../store/internal';\n",
      'app/src/cli/run.ts': "import { x } from '../store/contract/x.js';\nimport { s } from '../store/store';\n",
      'app/src/store/view.ts': "import { m } from '../core/model';\nimport { g } from './gone';\n",
      'app/src/loose.ts': "import { x } from './core/nowhere';\n",
      'app/src/app/uses.ts': "import { l } from '../loose';\nimport { out } from '../../lib/out';\n",
      'app/lib/out.ts': 'export const out = 1;\n',
      'app/src/core/peek.test.ts': "import { x } from '../store/contract/x';\n",
    };
    const read = inspect(modules(), tree(texts), Object.keys(texts), unbounded());
    expect(read.violations.map(({ fingerprint, file, line, message, fix }) => ({ fingerprint, file, line, message, fix }))).toEqual([
      {
        fingerprint: 'uncovered @ loose.ts',
        file: 'app/src/loose.ts',
        line: 1,
        message: "lies in no module's territory",
        fix: 'Give it an owner: add `app/src/` or the file to the territory of the module that owns its meaning with `set_module`, or draw a module card for it.',
      },
      {
        fingerprint: 'core -> store @ core/peek.ts',
        file: 'app/src/core/peek.ts',
        line: 1,
        message: 'imports `../store/contract/x` of module `store`, which `core` has no relation to',
        fix: 'Where `core` truly depends on `store`, add the relation `core → store` with `set_module`; otherwise move this code to the module that owns its meaning, or reach it through a port `core` declares and composition fills.',
      },
      {
        fingerprint: 'app -> store private @ app/main.ts',
        file: 'app/src/app/main.ts',
        line: 4,
        message: 'imports `../store/internal` of module `store`, which no entry of `store` opens to `app`',
        fix: 'Import through an entry `store` opens to `app` (`app/src/store/contract/`, `app/src/store/store.ts`), or open one covering `app/src/store/internal.ts` with `set_module`.',
      },
      {
        fingerprint: 'cli -> store private @ cli/run.ts',
        file: 'app/src/cli/run.ts',
        line: 2,
        message: 'imports `../store/store` of module `store`, which no entry of `store` opens to `cli`',
        fix: 'Import through an entry `store` opens to `cli` (`app/src/store/contract/`), or open one covering `app/src/store/store.ts` with `set_module`.',
      },
      {
        fingerprint: 'app -> loose.ts unowned @ app/uses.ts',
        file: 'app/src/app/uses.ts',
        line: 1,
        message: "imports `../loose`, landing on `app/src/loose.ts`, which no module's territory covers",
        fix: 'Give `app/src/loose.ts` an owner: add it or its directory to the territory of the module that owns it with `set_module`.',
      },
      {
        fingerprint: 'store -> ./gone unresolved @ store/view.ts',
        file: 'app/src/store/view.ts',
        line: 2,
        message: 'imports `./gone`, which lands on no file the tree holds',
        fix: 'Land one of `app/src/store/gone`, `app/src/store/gone.ts`, `app/src/store/gone.tsx`, `app/src/store/gone/index.ts` with this change, or point the import at a file the tree holds.',
      },
    ]);
    expect(read.unjudged).toEqual([]);
  });

  it('names as absent only the paths an unresolved import would cross nothing by landing on', () => {
    const texts = {
      ...store,
      'app/src/app/main.ts':
        "import { a } from '../store/contract/fresh.js';\nimport { b } from '../store/hidden.js';\nimport { c } from '../cli/tool.js';\n",
    };
    const read = inspect(modules(), tree(texts), ['app/src/app/main.ts'], unbounded());
    expect(
      read.violations.map(({ fingerprint, absent }) => ({
        fingerprint,
        entry: absent?.includes('app/src/store/contract/fresh.ts') ?? null,
      })),
    ).toEqual([
      { fingerprint: 'app -> ../store/contract/fresh.js unresolved @ app/main.ts', entry: true },
      { fingerprint: 'app -> ../store/hidden.js unresolved @ app/main.ts', entry: null },
      { fingerprint: 'app -> ../cli/tool.js unresolved @ app/main.ts', entry: null },
    ]);
  });

  it('judges an import of an asset nobody owns, and of one a module owns, as it judges code', () => {
    const texts = {
      ...store,
      'app/src/loose/x.json': '{}',
      'app/src/store/data.json': '{}',
      'app/src/core/j.ts': "import x from '../loose/x.json';\nimport d from '../store/data.json';\n",
    };
    expect(prints(inspect(modules(), tree(texts), ['app/src/core/j.ts'], unbounded()).violations)).toEqual([
      'core -> loose/x.json unowned @ core/j.ts',
      'core -> store @ core/j.ts',
    ]);
  });

  it('judges only the files the module map draws', () => {
    const texts = {
      ...store,
      'app/src/core/peek.ts': "import { i } from '../store/internal';\n",
      'app/src/other/free.ts': "import { i } from '../store/internal';\n",
    };
    expect(prints(inspect(modules({}, { region: ['core/', 'store/'] }), tree(texts), Object.keys(texts), unbounded()).violations)).toEqual([
      'core -> store @ core/peek.ts',
    ]);
  });

  it('holds tests to their module and applies testing entries to foreign importers while internal imports across cuts keep their owner', () => {
    const testing = modules(
      { tests: ['.test'], files: { extensions: ['.ts'], exclude: [] } },
      {
        modules: [
          { id: 'core', territory: ['core/', 'loose/model.ts'], entries: [{ at: 'core/' }, { at: 'core/testing/', role: 'testing' }] },
          {
            id: 'store',
            territory: ['store/'],
            entries: [{ at: 'store/contract/' }, { at: 'store/testing/', role: 'testing', for: ['app'] }],
          },
          { id: 'app', territory: ['app/'] },
          { id: 'cli', territory: ['cli/'] },
        ],
      },
    );
    const texts = {
      ...store,
      'app/src/core/testing/fake.ts': "import { i } from '../../store/internal';\nexport const fake = 1;\n",
      'app/src/store/testing/double.ts': 'export const double = 1;\n',
      'app/src/app/main.test.ts':
        "import { i } from '../store/internal';\nimport { fake } from '../core/testing/fake';\nimport { double } from '../store/testing/double';\n",
      'app/src/cli/run.test.ts': "import { fake } from '../core/testing/fake';\nimport { double } from '../store/testing/double';\n",
      'app/src/cli/run.ts': "import { fake } from '../core/testing/fake';\n",
      'app/src/core/wire.ts': "import { fake } from './testing/fake';\n",
      'app/src/core/wire.test.ts': "import { fake } from './testing/fake';\n",
      'app/src/core/testing/seed.ts': "import { fake } from './fake';\n",
      'app/src/loose/model.test.ts': "import { x } from '../store/contract/x';\n",
      'app/src/loose/model.ts': "import { fake } from '../core/testing/fake';\n",
      'app/src/loose/orphan.test.ts': '',
    };
    expect(prints(inspect(testing, tree(texts), Object.keys(texts), unbounded()).violations)).toEqual([
      'app -> store private @ app/main.test.ts',
      'cli -> core @ cli/run.ts',
      'cli -> store private @ cli/run.test.ts',
      'core -> store @ core/testing/fake.ts',
      'core -> store @ loose/model.test.ts',
      'uncovered @ loose/orphan.test.ts',
    ]);
  });

  it('lets a `testing` relation carry the test code of its module alone', () => {
    const related = modules(
      { tests: ['.test'], files: { extensions: ['.ts'], exclude: [] } },
      { relations: [...RELATIONS, { from: 'cli', to: 'core', role: 'testing' }] },
    );
    const texts = {
      ...store,
      'app/src/cli/tool.test.ts': "import { m } from '../core/model';\n",
      'app/src/cli/tool.ts': "import { m } from '../core/model';\n",
    };
    expect(prints(inspect(related, tree(texts), Object.keys(texts), unbounded()).violations)).toEqual(['cli -> core @ cli/tool.ts']);
  });

  it('opens a `port` entry’s types to every related module and its values to the modules it names', () => {
    const ports = modules(
      {},
      {
        modules: [
          { id: 'core', territory: ['core/'], entries: [{ at: 'core/Port.ts', role: 'port', for: ['store'] }] },
          { id: 'store', territory: ['store/'] },
          { id: 'app', territory: ['app/'] },
          { id: 'cli', territory: ['cli/'] },
        ],
      },
    );
    const texts = {
      'app/src/core/Port.ts': 'export type Port = { a: 1 };\nexport const port = 1;\n',
      'app/src/app/types.ts': "import type { Port } from '../core/Port';\n",
      'app/src/app/values.ts': "import { port } from '../core/Port';\n",
      'app/src/store/fill.ts': "import { port } from '../core/Port';\n",
    };
    expect(prints(inspect(ports, tree(texts), Object.keys(texts), unbounded()).violations)).toEqual([
      'app -> core private @ app/values.ts',
    ]);
  });

  const capped = (files: number) => budgetOf('modules', deriveCalibration(ASK_BUDGET_MS / files, 1, 1024 * 1024));

  it('refuses a reading past its envelope before parsing, never answering it clean', () => {
    const texts = { ...store, 'app/src/core/a.ts': '', 'app/src/core/b.ts': '' };
    const inspection = modules();
    if (inspection.builtin !== 'modules') throw new Error('modules');
    expect(() => reading.read(inspection.params, tree(texts), Object.keys(texts), ADAPTERS, capped(2))).toThrow(EnvelopeExceeded);
  });

  it('keeps the source-probe ceiling when different files share one blob', () => {
    const values = { 'app/src/core/a.ts': '', 'app/src/core/b.ts': '' };
    const inspection = modules();
    if (inspection.builtin !== 'modules') throw new Error('modules');
    const same: Tree = { ...tree(values), object: () => 'shared', size: () => 1 };
    expect(() => reading.read(inspection.params, same, Object.keys(values), ADAPTERS, capped(1))).toThrow(EnvelopeExceeded);
  });

  it('gives a path to the module whose territory entry covering it is longest', () => {
    const nested = modules(
      {},
      {
        modules: [
          { id: 'core', territory: ['core/'] },
          { id: 'store', territory: ['store/', 'core/store.ts'] },
        ],
        relations: [{ from: 'store', to: 'core' }],
      },
    );
    const texts = { 'app/src/core/store.ts': "import { m } from './model';\n", 'app/src/core/model.ts': "import { s } from './store';\n" };
    expect(prints(inspect(nested, tree(texts), Object.keys(texts), unbounded()).violations)).toEqual(['core -> store @ core/model.ts']);
  });

  it('leaves an uncovered file and an unresolved import unjudged when the policy says so', () => {
    const texts = { 'app/src/loose.ts': '', 'app/src/app/main.ts': "import { g } from './gone';\n" };
    expect(inspect(modules({ coverage: 'allow', unresolved: 'unjudged' }), tree(texts), Object.keys(texts), unbounded())).toEqual({
      violations: [],
      unjudged: [{ file: 'app/src/app/main.ts', line: 1, specifier: './gone' }],
    });
  });
});

describe('modules: a module order', () => {
  const ordered = (order: MapModule['order']) =>
    modules(
      { tests: ['.test'], files: { extensions: ['.ts'], exclude: [] } },
      {
        modules: [
          {
            id: 'store',
            territory: ['store/'],
            entries: [{ at: 'store/testing/', role: 'testing' }],
            order,
          },
        ],
        relations: [],
      },
    );
  const texts = {
    'app/src/store/wire/row.ts': "import { table } from '../tables';\n",
    'app/src/store/wire/key.ts': "import { row } from './row';\n",
    'app/src/store/tables.ts': "import { row } from './wire/row';\n",
    'app/src/store/plan/cost.ts': "import { key } from '../wire/key';\nimport { split } from '../split/split';\n",
    'app/src/store/split/split.ts': "import { cost } from '../plan/cost';\n",
    'app/src/store/loose/free.ts': "import { table } from '../tables';\n",
    'app/src/store/wire/row.test.ts': "import { table } from '../tables';\n",
    'app/src/store/testing/fake.ts': "import { table } from '../tables';\n",
  };

  it('refuses an import up the floors and across two entries of one floor, by the longest entry covering each file, and lets one down or inside its entry stand', () => {
    const inspection = ordered([['store/wire/'], ['store/plan/', 'store/split/', 'store/testing/'], ['store/']]);
    const read = inspect(inspection, tree(texts), Object.keys(texts), unbounded());
    expect(prints(read.violations)).toEqual([
      'store order store/plan/cost.ts -> store/split/',
      'store order store/split/split.ts -> store/plan/',
      'store order store/testing/fake.ts -> store/',
      'store order store/wire/row.ts -> store/',
    ]);
    expect(read.violations.find(({ fingerprint }) => fingerprint === 'store order store/plan/cost.ts -> store/split/')?.fix).toBe(
      'Import down the order of `store`: move what this file needs from `app/src/store/split/` onto a floor below `app/src/store/plan/` (`app/src/store/wire/`), or reorder the floors with `set_module` where `app/src/store/split/` truly stands lower.',
    );
  });

  it('leaves a file no order entry covers free, and a module without an order judges no import inside it', () => {
    const lower = ordered([['store/wire/'], ['store/plan/']]);
    expect(prints(inspect(lower, tree(texts), Object.keys(texts), unbounded()).violations)).toEqual([]);
    expect(prints(inspect(ordered(undefined), tree(texts), Object.keys(texts), unbounded()).violations)).toEqual([]);
  });
});

describe('modules: changing a card', () => {
  const before = modules();
  const texts = { ...store, 'app/src/app/main.ts': "import { x } from '../store/contract/x';" };
  const measure = (after: Assembled, side: Tree, fingerprints: readonly string[] = []) =>
    inspect(after, side, remapped(after, before, side, fingerprints, unbounded())?.paths ?? [...side.paths!()], unbounded());

  it('opens an entry or relation without reading existing consumers', () => {
    const side = tree(texts, (path) => {
      throw new Error(`unchanged source read: ${path}`);
    });
    for (const after of [
      modules(
        {},
        { modules: MODULES.map((one) => (one.id === 'store' ? { ...one, entries: [...one.entries!, { at: 'store/internal.ts' }] } : one)) },
      ),
      modules({}, { relations: [...RELATIONS, { from: 'cli', to: 'core' }] }),
    ])
      expect(measure(after, side)).toEqual({ violations: [], unjudged: [] });
  });

  it('measures the reach when the inspection policy changes alongside a map', () => {
    const prior = modules({ unresolved: 'unjudged' });
    const side = tree({ ...store, 'app/src/app/main.ts': "import { missing } from './missing';" });
    const after = modules();
    expect(
      prints(inspect(after, side, remapped(after, prior, side, [], unbounded())?.paths ?? [...side.paths!()], unbounded()).violations),
    ).toEqual(['app -> ./missing unresolved @ app/main.ts']);
  });

  it('finds an importer when its entry, relation, or testing access is narrowed', () => {
    for (const after of [
      modules(
        {},
        { modules: MODULES.map((one) => (one.id === 'store' ? { ...one, entries: [{ at: 'store/store.ts', for: ['app'] }] } : one)) },
      ),
      modules({}, { relations: RELATIONS.filter(({ from, to }) => from !== 'app' || to !== 'store') }),
      modules(
        {},
        { modules: MODULES.map((one) => (one.id === 'store' ? { ...one, entries: [{ at: 'store/contract/', role: 'testing' }] } : one)) },
      ),
    ])
      expect(measure(after, tree(texts)).violations.map(({ file }) => file)).toEqual(['app/src/app/main.ts']);
  });

  it('projects ancestor entries onto base and retains debt whose source path contains fingerprint separators', () => {
    const prior = modules({ base: 'src/domain' }, { modules: [], relations: [] });
    if (prior.builtin !== 'modules') throw new Error('modules');
    const before: Assembled = {
      builtin: 'modules',
      params: {
        ...prior.params,
        map: {
          modules: [
            { id: 'core', territory: ['src/'], entries: [{ at: 'src/' }] },
            { id: 'app', territory: ['src/domain/app/'] },
          ],
          relations: [{ from: 'app', to: 'core' }],
          region: ['src/'],
        },
      },
    };
    const after: Assembled = { builtin: 'modules', params: { ...before.params, map: { ...before.params.map, relations: [] } } };
    const side = tree({ 'src/domain/value.ts': 'export const x = 1;', 'src/domain/app/main.ts': "import { x } from '../value';" });
    expect(prints(inspect(after, side, remapped(after, before, side, [], unbounded())!.paths, unbounded()).violations)).toEqual([
      'app -> core @ app/main.ts',
    ]);
    const unusual = tree({ ...store, 'app/src/core/a @ b.ts': "import { x } from '../store/contract/x';" });
    const opened = modules(
      {},
      { modules: MODULES.map((one) => (one.id === 'store' ? { ...one, entries: [...one.entries!, { at: 'store/internal.ts' }] } : one)) },
    );
    expect(prints(measure(opened, unusual, ['core -> store @ core/a @ b.ts']).violations)).toEqual(['core -> store @ core/a @ b.ts']);
  });

  it('rejudges source files losing their testing role and retains the paths of existing debt for retirement', () => {
    const policy = { tests: ['.test'], files: { extensions: ['.ts'], exclude: [] } };
    const drawn = MODULES.map((one) => (one.id === 'app' ? { ...one, entries: [{ at: 'app/testing/', role: 'testing' as const }] } : one));
    const prior = modules(policy, {
      modules: drawn,
      relations: RELATIONS.map((one) => (one.from === 'app' && one.to === 'core' ? { ...one, role: 'testing' } : one)),
    });
    const after = modules(policy, {
      relations: RELATIONS.map((one) => (one.from === 'app' && one.to === 'core' ? { ...one, role: 'testing' } : one)),
    });
    const side = tree({ ...store, 'app/src/app/testing/fake.ts': "import { m } from '../../core/model';" });
    const paths = remapped(after, prior, side, [], unbounded())!.paths;
    expect(prints(inspect(after, side, paths, unbounded()).violations)).toEqual(['app -> core @ app/testing/fake.ts']);
    const opened = modules({}, { relations: [...RELATIONS, { from: 'core', to: 'store' }] });
    const debt = tree({ ...store, 'app/src/core/old.ts': "import { x } from '../store/contract/x';" });
    expect(measure(opened, debt, ['core -> store @ core/old.ts'])).toEqual({ violations: [], unjudged: [] });
  });
});

describe('judge: modules', () => {
  const upward = "import { x } from '../store/contract/x';\n";

  it('judges literal lazy and eager globs and dynamic imports through the same module relation', () => {
    const path = 'app/src/core/peek.ts';
    const source = tree(store);
    const built = tree({
      ...store,
      [path]: "import.meta.glob('../store/contract/*.ts');\nimport('../store/contract/x.ts');\n",
    });
    const change = { base: source, built, paths: [path] };
    expect(judge(modules(), change, [], unbounded()).violations).toMatchObject([
      {
        fingerprint: 'core -> store @ core/peek.ts',
        specifier: '../store/contract/*.ts',
        sites: [
          { line: 1, specifier: '../store/contract/*.ts' },
          { line: 2, specifier: '../store/contract/x.ts' },
        ],
      },
    ]);
    const related = modules({}, { relations: [{ from: 'core', to: 'store' }] });
    expect(judge(related, change, [], unbounded()).violations).toEqual([]);
    expect(
      judge(
        modules(),
        {
          ...change,
          built: tree({ ...store, [path]: "import.meta.glob('../store/contract/*.ts', { eager: true });" }),
        },
        [],
        unbounded(),
      ).violations,
    ).toMatchObject([{ fingerprint: 'core -> store @ core/peek.ts', specifier: '../store/contract/*.ts' }]);
  });

  it('rejudges an unchanged glob importer when matching files appear or disappear, respecting exclusions', () => {
    const path = 'app/src/core/peek.ts';
    const target = 'app/src/store/contract/x.ts';
    const excluded = 'app/src/store/contract/ignored.ts';
    const texts = {
      [path]: "import.meta.glob(['../store/contract/*.ts', '!../store/contract/ignored.ts']);",
      [excluded]: '',
    };
    const added = { ...texts, [target]: '' };
    const change = { base: tree(texts), built: tree(added), paths: [target] };
    expect(prints(judge(modules(), change, [], unbounded()).violations)).toEqual(['core -> store @ core/peek.ts']);
    expect(judge(modules(), { base: tree(added), built: tree(texts), paths: [target] }, [], unbounded()).violations).toEqual([]);
    expect(
      judge(modules(), { base: tree({ [path]: texts[path] }), built: tree(texts), paths: [excluded] }, [], unbounded()).violations,
    ).toEqual([]);
    const views = new Map<string, ReachView<unknown, unknown>>();
    const empty = { head: undefined, members: undefined, node: () => undefined, sources: () => [], watchers: () => [] };
    const table: ReachTable = {
      open: <N, M>(key: string) => (views.get(key) ?? empty) as ReachView<N, M>,
      apply: (key, _from, to, delta, members) => {
        const before = views.get(key) ?? empty;
        views.set(key, {
          ...overlay(before, delta),
          head: { tree: to, generation: (before.head?.generation ?? 0) + 1 },
          members,
        });
        return 'applied';
      },
    };
    const indexed = (values: Record<string, string>, snapshot: string): Tree => ({ ...tree(values), snapshot, slot: 'checkout' });
    const full = indexed(added, 'full');
    const removed = indexed(texts, 'removed');
    const seed = memoWrites(new Map(), table);
    expect(judge(modules(), { base: full, built: removed, paths: [target] }, [], unbounded(), ADAPTERS, seed).violations).toEqual([]);
    seed.commit();
    const memo = memoWrites(new Map(), table);
    expect(prints(judge(modules(), { base: removed, built: full, paths: [target] }, [], unbounded(), ADAPTERS, memo).violations)).toEqual([
      'core -> store @ core/peek.ts',
    ]);
    memo.commit();
    expect(
      judge(modules(), { base: full, built: removed, paths: [target] }, [], unbounded(), ADAPTERS, memoWrites(new Map(), table)).violations,
    ).toEqual([]);
  });

  it('judges a glob as a value import at a port entry', () => {
    const inspection = modules(
      {},
      {
        modules: [
          { id: 'core', territory: ['core/'] },
          { id: 'store', territory: ['store/'], entries: [{ at: 'store/contract/', role: 'port', for: ['store'] }] },
        ],
        relations: [{ from: 'core', to: 'store' }],
      },
    );
    const path = 'app/src/core/peek.ts';
    expect(
      prints(
        inspect(inspection, tree({ ...store, [path]: "import.meta.glob('../store/contract/*.ts');" }), [path], unbounded()).violations,
      ),
    ).toEqual(['core -> store private @ core/peek.ts']);
  });

  it('names loads known only at run time unjudged under either policy and judges a rooted glob from the deepest root holding its file', () => {
    const path = 'app/src/core/peek.ts';
    const texts = {
      ...store,
      [path]: "import.meta.glob('/src/store/contract/*.ts');\nimport.meta.glob('../store/*.ts', { query: '?raw' });\nimport(name);",
    };
    for (const unresolved of ['refuse', 'unjudged'] as const) {
      const loose = inspect(modules({ unresolved }), tree(texts), [path], unbounded());
      expect(loose.violations).toEqual([]);
      expect(loose.unjudged.map(({ line }) => line).sort()).toEqual([1, 2, 3]);
    }
    const rooted = inspect(modules({ roots: ['', 'app'] }), tree(texts), [path], unbounded());
    expect(prints(rooted.violations)).toEqual(['core -> store @ core/peek.ts']);
    expect(rooted.unjudged.map(({ line }) => line).sort()).toEqual([2, 3]);
    const bracketed = Object.fromEntries(Object.entries(texts).map(([at, text]) => [at.replace(/^app\//, '[app]/'), text]));
    const literal = inspect(modules({ base: '[app]/src', roots: ['[app]'] }), tree(bracketed), ['[app]/src/core/peek.ts'], unbounded());
    expect(prints(literal.violations)).toEqual(['core -> store @ core/peek.ts']);
    expect(inspect(modules({ reads: 'from' }), tree(texts), [path], unbounded())).toEqual({ violations: [], unjudged: [] });
  });

  it('judges a changed package door inside the source envelope when its unchanged consumer has a large shared blob', () => {
    const inspection = modules(
      { base: '' },
      {
        modules: [
          { id: 'app', territory: ['app/'] },
          { id: 'kit', territory: ['libs/kit/'], entries: [{ at: 'libs/kit/public.ts' }] },
        ],
        relations: [{ from: 'app', to: 'kit' }],
        region: ['app/', 'libs/'],
      },
    );
    const texts = {
      'package.json': JSON.stringify({ workspaces: ['libs/*'] }),
      'libs/kit/package.json': JSON.stringify({ name: 'kit', exports: { '.': './public.ts' } }),
      'libs/kit/public.ts': 'export const x = 1;',
      'libs/kit/private.ts': 'export const x = 2;',
      'app/main.ts': "import { x } from 'kit';",
    };
    const side = (values: Record<string, string>): Tree => ({
      ...tree(values),
      object: (path) => (values[path] === undefined ? undefined : Bun.hash(values[path]!).toString()),
      size: (path) => (path === 'app/main.ts' ? 41 * 1024 * 1024 : values[path]?.length),
    });
    const verdict = judge(
      inspection,
      {
        base: side(texts),
        built: side({ ...texts, 'libs/kit/package.json': JSON.stringify({ name: 'kit', exports: { '.': './private.ts' } }) }),
        paths: ['libs/kit/package.json'],
      },
      [],
      unbounded(),
    );
    expect(prints(verdict.violations)).toEqual(['app -> kit private @ app/main.ts']);
    expect(verdict.unjudged).toEqual([]);
  });

  it('judges an added package entry without reading existing consumers, and finds the importer of a removed entry', () => {
    const inspection = modules(
      { base: '' },
      {
        modules: [
          { id: 'app', territory: ['app/'] },
          { id: 'kit', territory: ['libs/kit/'], entries: [{ at: 'libs/kit/public.ts' }, { at: 'libs/kit/fresh.ts' }] },
        ],
        relations: [{ from: 'app', to: 'kit' }],
        region: ['app/', 'libs/'],
      },
    );
    const manifest = 'libs/kit/package.json';
    const entry = { name: 'kit', exports: { '.': './public.ts', './old/*': './old/*.ts' } };
    const texts = {
      'package.json': JSON.stringify({ workspaces: ['libs/*'] }),
      [manifest]: JSON.stringify(entry),
      'libs/kit/public.ts': 'export const x = 1;',
      'libs/kit/fresh.ts': 'export const fresh = 1;',
      'app/main.ts': "import { x } from 'kit';",
      'app/other.ts': "import { x } from 'kit';",
      'app/third.ts': "import { x } from 'kit';",
    };
    const expanded = { ...texts, [manifest]: JSON.stringify({ ...entry, exports: { ...entry.exports, './fresh': './fresh.ts' } }) };
    const forbidSource = (path: string) => {
      if (path.endsWith('.ts')) throw new Error(`unchanged source read: ${path}`);
    };
    for (const values of [
      expanded,
      {
        ...texts,
        [manifest]: JSON.stringify({ ...entry, exports: { ...entry.exports, './new/*': './*.ts' } }),
      },
    ]) {
      const opening = judge(
        inspection,
        { base: tree(texts, forbidSource), built: tree(values, forbidSource), paths: [manifest] },
        [],
        unbounded(),
      );
      expect([opening.violations, opening.unjudged]).toEqual([[], []]);
    }
    const users = { ...expanded, 'app/fresh.ts': "import { fresh } from 'kit/fresh';" };
    const narrowing = judge(
      inspection,
      {
        base: tree(users),
        built: tree({ ...users, [manifest]: texts[manifest] }),
        paths: [manifest],
      },
      [],
      unbounded(),
    );
    expect(prints(narrowing.violations)).toEqual(['app -> kit/fresh unresolved @ app/fresh.ts']);
  });

  it('rejudges a newly added exact export that redirects an existing wildcard entry to a private file', () => {
    const inspection = modules(
      { base: '' },
      {
        modules: [
          { id: 'app', territory: ['app/'] },
          { id: 'kit', territory: ['libs/kit/'], entries: [{ at: 'libs/kit/public/' }] },
        ],
        relations: [{ from: 'app', to: 'kit' }],
        region: ['app/', 'libs/'],
      },
    );
    const manifest = 'libs/kit/package.json';
    const exports = { './*': './public/*.ts' };
    const texts = {
      'package.json': JSON.stringify({ workspaces: ['libs/*'] }),
      [manifest]: JSON.stringify({ name: 'kit', exports }),
      'libs/kit/public/x.ts': 'export const x = 1;',
      'libs/kit/private.ts': 'export const x = 2;',
      'app/main.ts': "import { x } from 'kit/x';",
    };
    const result = judge(
      inspection,
      {
        base: tree(texts),
        built: tree({ ...texts, [manifest]: JSON.stringify({ name: 'kit', exports: { ...exports, './x': './private.ts' } }) }),
        paths: [manifest],
      },
      [],
      unbounded(),
    );
    expect(prints(result.violations)).toEqual(['app -> kit private @ app/main.ts']);
  });

  it('does not reread source files for script or dependency-range changes that preserve import resolution', () => {
    const manifest = { workspaces: ['libs/*'], dependencies: { external: '1' } };
    const texts = { ...store, 'package.json': JSON.stringify(manifest), 'app/src/app/main.ts': "import external from 'external';" };
    const reads = new Set<string>();
    const verdict = judge(
      modules(),
      {
        base: tree(texts, (path) => reads.add(path)),
        built: tree(
          { ...texts, 'package.json': JSON.stringify({ ...manifest, scripts: { build: 'build' }, dependencies: { external: '2' } }) },
          (path) => reads.add(path),
        ),
        paths: ['package.json'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.unjudged).toEqual([]);
    expect([...reads]).toEqual(['package.json']);
  });

  it('refuses a new file taking an indebted edge, and lets an indebted file import along its edge again', () => {
    const verdict = judge(
      modules(),
      {
        base: tree({ ...store, 'app/src/core/a.ts': upward }),
        built: tree({
          ...store,
          'app/src/core/a.ts': `${upward}import { y } from '../store/contract/x.js';\n`,
          'app/src/core/b.ts': upward,
        }),
        paths: ['app/src/core/a.ts', 'app/src/core/b.ts'],
      },
      [],
      unbounded(),
    );
    expect(prints(verdict.violations)).toEqual(['core -> store @ core/b.ts']);
  });

  it('lets a violation follow a file moved with its body, whatever its imports became, and judges a replacement or another arrival on the edge new', () => {
    const body = 'export const o = x;\n';
    const base = { ...store, 'app/src/core/a.ts': `${upward}${body}` };
    const change = (built: Record<string, string>) => ({
      base: tree(base),
      built: tree({ ...store, ...built }),
      paths: ['app/src/core/a.ts', ...Object.keys(built)],
    });
    expect(
      judge(modules(), change({ 'app/src/core/deep/a.ts': `import { x } from '../../store/contract/x';\n${body}` }), [], unbounded())
        .violations,
    ).toEqual([]);
    expect(
      prints(
        judge(modules(), change({ 'app/src/core/b.ts': `${upward}export function other() { return x * 2; }\n` }), [], unbounded())
          .violations,
      ),
    ).toEqual(['core -> store @ core/b.ts']);
    expect(
      prints(
        judge(modules(), change({ 'app/src/core/b.ts': `${upward}${body}`, 'app/src/core/c.ts': upward }), [], unbounded()).violations,
      ),
    ).toEqual(['core -> store @ core/c.ts']);
    const elsewhere = modules({}, { relations: [{ from: 'app', to: 'core' }] });
    expect(prints(judge(elsewhere, change({ 'app/src/app/a.ts': `${upward}${body}` }), [], unbounded()).violations)).toEqual([
      'app -> store @ app/a.ts',
    ]);
  });

  it('follows a moved violation without charging a shared large blob again for its body digest', () => {
    const text = `${upward}export const x = 1;`;
    const side = (values: Record<string, string>): Tree => ({
      ...tree(values),
      object: (path) => (values[path] === undefined ? undefined : Bun.hash(values[path]!).toString()),
      size: (path) => (path.startsWith('app/src/core/') ? 41 * 1024 * 1024 : values[path]?.length),
    });
    const verdict = judge(
      modules(),
      {
        base: side({ 'app/src/store/contract/x.ts': '', 'app/src/core/a.ts': text }),
        built: side({ 'app/src/store/contract/x.ts': '', 'app/src/core/b.ts': text }),
        paths: ['app/src/core/a.ts', 'app/src/core/b.ts'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.followed).toEqual([{ from: 'core -> store @ core/a.ts', to: 'core -> store @ core/b.ts' }]);
  });

  it('refuses an affected-consumer judgement when its built side cannot list paths', () => {
    const base = { ...store, 'app/src/app/main.ts': "import { x } from '../store/contract/x';" };
    const built: Tree = { ...tree({ 'app/src/app/main.ts': base['app/src/app/main.ts'] }), paths: undefined };
    expect(() => judge(modules(), { base: tree(base), built, paths: ['app/src/store/contract/x.ts'] }, [], unbounded())).toThrow(
      UnsupportedSource,
    );
  });

  it('rejudges aliases when a nested config is removed or an inherited configuration changes', () => {
    const main = { 'app/src/app/main.ts': "import { x } from '$api';" };
    const root = { 'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'app/src', paths: { $api: ['store/internal.ts'] } } }) };
    const nested = 'app/src/app/tsconfig.json';
    const options = (target: string) => JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { $api: [target] } } });
    const before = { ...store, ...main, ...root, [nested]: options('store/contract/x.ts') };
    expect(
      prints(
        judge(modules(), { base: tree(before), built: tree({ ...store, ...main, ...root }), paths: [nested] }, [], unbounded()).violations,
      ),
    ).toEqual(['app -> store private @ app/main.ts']);
    const inherited = {
      ...store,
      ...main,
      [nested]: JSON.stringify({ extends: './options.json' }),
      'app/src/app/options.json': options('store/contract/x.ts'),
    };
    expect(
      prints(
        judge(
          modules(),
          {
            base: tree(inherited),
            built: tree({ ...inherited, 'app/src/app/options.json': options('store/internal.ts') }),
            paths: ['app/src/app/options.json'],
          },
          [],
          unbounded(),
        ).violations,
      ),
    ).toEqual(['app -> store private @ app/main.ts']);
  });

  it('judges consumers when a change removes the tracked source behind a declared built output', () => {
    const inspection = modules({
      built: [{ output: 'store/out.js', source: 'store/contract/x.ts', why: 'The source owns the emitted contract.' }],
    });
    const main = { 'app/src/app/main.ts': "import { x } from '../store/out.js';" };
    const { 'app/src/store/contract/x.ts': _gone, ...kept } = store;
    const verdict = judge(
      inspection,
      {
        base: tree({ ...store, ...main }),
        built: tree({ ...kept, ...main }),
        paths: ['app/src/store/contract/x.ts'],
      },
      [],
      unbounded(),
    );
    expect(prints(verdict.violations)).toEqual(['app -> ../store/out.js unresolved @ app/main.ts']);
  });

  it('allows a change to repair an unparseable base file while removing an unused path', () => {
    const verdict = judge(
      modules(),
      {
        base: tree({ ...store, 'app/src/app/main.ts': 'export const broken = ;' }),
        built: tree({ 'app/src/app/main.ts': 'export const fixed = 1;' }),
        paths: [...Object.keys(store), 'app/src/app/main.ts'],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations).toEqual([]);
    expect(verdict.unjudged).toEqual([]);
  });

  it('judges an unchanged file importing an asset the change removes', () => {
    const uses = { 'app/src/app/uses.ts': "import d from '../store/data.json';\n" };
    const verdict = judge(
      modules(),
      {
        base: tree({ ...store, ...uses, 'app/src/store/data.json': '{}' }),
        built: tree({ ...store, ...uses }),
        paths: ['app/src/store/data.json'],
      },
      [],
      unbounded(),
    );
    expect(prints(verdict.violations)).toEqual(['app -> ../store/data.json unresolved @ app/uses.ts']);
  });

  it('reads only the files an adding change adds', () => {
    const read = new Set<string>();
    const texts = { ...store, 'app/src/app/main.ts': "import { m } from '../core/model';\n" };
    const added = 'app/src/app/extra.ts';
    const verdict = judge(
      modules(),
      {
        base: tree(texts, (path) => read.add(path)),
        built: tree({ ...texts, [added]: "import { m } from '../core/model';\n" }, (path) => read.add(path)),
        paths: [added],
      },
      [],
      unbounded(),
    );
    expect(verdict.violations).toEqual([]);
    expect([...read]).toEqual([added]);
  });

  it('judges an unchanged file a change breaks by removing what it imports', () => {
    const main = { 'app/src/app/main.ts': "import { m } from '../core/model';\n" };
    const verdict = judge(
      modules(),
      {
        base: tree({ ...store, ...main }),
        built: tree({ ...main, 'app/src/store/store.ts': store['app/src/store/store.ts'] }),
        paths: ['app/src/core/model.ts'],
      },
      [],
      unbounded(),
    );
    expect(prints(verdict.violations)).toEqual(['app -> ../core/model unresolved @ app/main.ts']);
  });

  it('reads no file beyond an edit-only change', () => {
    const read = new Set<string>();
    const texts = { ...store, 'app/src/app/main.ts': "import { m } from '../core/model';\n" };
    const verdict = judge(
      modules(),
      {
        base: tree(texts, (path) => read.add(path)),
        built: tree({ ...texts, 'app/src/app/main.ts': `export const a = 1;\n${texts['app/src/app/main.ts']}` }, (path) => read.add(path)),
        paths: ['app/src/app/main.ts'],
      },
      [],
      unbounded(),
    );
    expect([verdict.violations, verdict.unjudged]).toEqual([[], []]);
    expect([...read]).toEqual(['app/src/app/main.ts']);
  });
});
