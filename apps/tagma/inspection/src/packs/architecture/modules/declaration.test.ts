import { describe, expect, it } from 'bun:test';
import { Result, Schema } from 'effect';
import { type Assembled, BUILTINS, type Inspection, mapProblem, type Params, relevant } from '../../../builtins';
import type { MapModule, ModuleMap } from '../../../core/rule';

const MODULES: readonly MapModule[] = [
  { id: 'core', territory: ['app/src/core/', 'app/src/shared.ts'] },
  {
    id: 'store',
    territory: ['app/src/store/', 'app/src/core/store.ts'],
    entries: [{ at: 'app/src/store/contract/' }, { at: 'app/src/store/store.ts', for: ['app'] }],
  },
  { id: 'app', territory: ['app/src/app/'] },
];

const RELATIONS: ModuleMap['relations'] = [
  { from: 'store', to: 'core' },
  { from: 'app', to: 'store' },
  { from: 'app', to: 'core' },
];

const policy = (change: Partial<Params<'modules'>> = {}): Params<'modules'> => ({
  base: 'app/src',
  cycles: 'refuse',
  coverage: 'allow',
  unresolved: 'unjudged',
  reads: 'every',
  conditions: [],
  files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  ...change,
});

const stored = (change: Partial<Params<'modules'>> = {}): Inspection => ({ builtin: 'modules', params: policy(change) });

const map = (change: Partial<ModuleMap> = {}): ModuleMap => ({ modules: MODULES, relations: RELATIONS, region: ['app/src/'], ...change });

const problem = (change: Partial<ModuleMap>, rule: Partial<Params<'modules'>> = {}) => mapProblem(stored(rule), map(change));

describe('modules parameters', () => {
  it('accepts framework names, subpath families and a sibling name, but refuses deeper paths and unrestricted wildcards', () => {
    const decodes = (framework: readonly string[]) =>
      Result.isSuccess(Schema.decodeUnknownResult(BUILTINS.modules.params)({ ...policy(), framework }));
    expect(decodes(['$app/*', '$env/static/public', 'virtual:routes', '@framework/runtime/*', './$types'])).toBe(true);
    for (const name of ['./a/b', './*', './..', '../local', '../local/*', '/absolute', '*', '$app/**', '$app*'])
      expect(decodes([name])).toBe(false);
  });

  it('refuses ambiguous built outputs and mappings that name directories instead of files', () => {
    const decodes = (change: object) => Result.isSuccess(Schema.decodeUnknownResult(BUILTINS.modules.params)({ ...policy(), ...change }));
    const mapping = { output: 'store/dist/x.js', source: 'store/contract/x.ts', why: 'Tracked source for the emitted entry.' };
    expect(decodes({ built: [mapping] })).toBe(true);
    expect(decodes({ built: [mapping, { ...mapping, source: 'core/x.ts' }] })).toBe(false);
    expect(decodes({ built: [{ ...mapping, output: 'store/dist/' }] })).toBe(false);
    expect(decodes({ built: [{ ...mapping, source: 'store/contract/' }] })).toBe(false);
  });
});

describe('the module map a modules rule takes', () => {
  it('refuses a map that names a module, a territory entry or a relation twice, or names a module it does not hold', () => {
    expect(problem({})).toBeUndefined();
    expect(problem({ modules: [...MODULES, { id: 'core', territory: ['other/'] }] })).toBeDefined();
    expect(problem({ modules: [...MODULES, { id: 'other', territory: ['app/src/core'] }] })).toBeDefined();
    expect(problem({ relations: [...RELATIONS, { from: 'app', to: 'core' }] })).toBeDefined();
    expect(problem({ relations: [{ from: 'app', to: 'nowhere' }] })).toBeDefined();
    expect(problem({ relations: [{ from: 'app', to: 'app' }] })).toBeDefined();
    expect(
      problem({
        modules: [{ id: 'core', territory: ['app/src/core/'], entries: [{ at: 'app/src/core/api/', for: ['nowhere'] }] }],
        relations: [],
      }),
    ).toBeDefined();
  });

  it("refuses an entry or an order entry outside its module's territory, and an order entry on two floors", () => {
    const core = (more: Partial<MapModule>): Partial<ModuleMap> => ({
      modules: [{ id: 'core', territory: ['app/src/core/'], ...more }],
      relations: [],
    });
    expect(problem(core({ entries: [{ at: 'app/src/core/api/' }] }))).toBeUndefined();
    expect(problem(core({ entries: [{ at: 'app/src/corex/api/' }] }))).toBeDefined();
    expect(problem(core({ order: [['app/src/core/wire/'], ['app/src/core/']] }))).toBeUndefined();
    expect(problem(core({ order: [['app/src/corex/']] }))).toBeDefined();
    expect(problem(core({ order: [['app/src/core/wire/'], ['app/src/core/wire/']] }))).toBeDefined();
  });

  it('refuses relations that close a cycle unless the rule allows one', () => {
    const cyclic = { relations: [...RELATIONS, { from: 'core', to: 'app' }] };
    expect(problem(cyclic)).toBeDefined();
    expect(problem(cyclic, { cycles: 'allow' })).toBeUndefined();
  });
});

describe('modules relevance', () => {
  it('takes changes under its base, including possible glob targets outside the region, and workspace manifests above it', () => {
    const run: Assembled = { builtin: 'modules', params: { ...policy(), map: map({ region: ['app/src/core/'] }) } };
    const paths = [
      'app/src/core/data.json',
      'app/src/store/s.ts',
      'app/src/store/package.json',
      'app/package.json',
      'package.json',
      'lib/package.json',
      'app/other.ts',
    ];
    expect(paths.filter((path) => relevant(run, path))).toEqual([
      'app/src/core/data.json',
      'app/src/store/s.ts',
      'app/src/store/package.json',
      'app/package.json',
      'package.json',
    ]);
  });
});
