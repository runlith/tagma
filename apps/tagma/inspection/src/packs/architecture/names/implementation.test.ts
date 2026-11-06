import { describe, expect, it } from 'bun:test';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import type { Tree } from '@runlith/code-facts/tree';
import type { Inspection, Params } from '../../../builtins';
import type { Violation } from '../../../core/verdict';
import { ASK_BUDGET_MS, budgetOf, deriveCalibration, EnvelopeExceeded, unbounded } from '../../../core/node/budget';
import { inspect } from '../../../core/node/implementations';
import { judge } from '../../../core/node/judge';
import { readNames } from './implementation';
import { ready } from '../../../builtins.node';

await ready('names');

type NameParams = Params<'names'>;

const params = (checks: NameParams['checks'], more: Partial<NameParams> = {}): NameParams => ({
  base: 'src',
  files: { extensions: ['.ts'], exclude: ['**/*.test.ts'] },
  uncovered: [],
  modules: [],
  services: ['Context.Service'],
  errors: ['Data.TaggedError', 'Error'],
  checks,
  glossary: [],
  ...more,
});

const names = (value: NameParams): Inspection => ({ builtin: 'names', params: value });

const tree = (texts: Record<string, string>, extra: Partial<Tree> = {}): Tree => ({
  has: (path) => Object.hasOwn(texts, path),
  read: (path) => {
    const text = texts[path];
    if (text === undefined) throw new Error(`${path} is not in the tree`);
    return text;
  },
  paths: () => Object.keys(texts),
  ...extra,
});

const found = (value: NameParams, texts: Record<string, string>): readonly Violation[] =>
  inspect(names(value), tree(texts), Object.keys(texts), unbounded()).violations;

const prints = (value: NameParams, texts: Record<string, string>): readonly string[] =>
  found(value, texts)
    .map(({ fingerprint }) => fingerprint)
    .sort();

const judged = (value: NameParams, base: Record<string, string>, built: Record<string, string>, debt: readonly string[] = []) =>
  judge(
    names(value),
    {
      base: tree(base),
      built: tree(built),
      paths: [...new Set([...Object.keys(base), ...Object.keys(built)])].filter((path) => base[path] !== built[path]),
    },
    debt,
    unbounded(),
  );

const fresh = (
  value: NameParams,
  base: Record<string, string>,
  built: Record<string, string>,
  debt: readonly string[] = [],
): readonly string[] =>
  judged(value, base, built, debt)
    .violations.map(({ fingerprint }) => fingerprint)
    .sort();

const lines = (count: number, name = 'v'): string =>
  Array.from({ length: count }, (_, at) => `export const ${name}${at} = ${at};`).join('\n');

describe('names: files', () => {
  it("F1 finds a file named after its directory and lets a module's own assembly file stand", () => {
    expect(
      prints(params({ F1: { exempt: [] } }, { modules: [{ id: 'graph', territory: ['graph/'] }] }), {
        'src/terminals/Terminals.ts': '',
        'src/graph/projects/Projects.ts': '',
        'src/graph/graph.ts': '',
        'src/graph/projects/store.ts': '',
      }),
    ).toEqual(['F1 graph/projects/Projects.ts', 'F1 terminals/Terminals.ts']);
  });

  it("F2 finds a first word repeating its directory's, a module's own directory counting with each of its words", () => {
    expect(
      prints(params({ F2: { exempt: [] } }, { modules: [{ id: 'native-harness', territory: ['native-harness/'] }] }), {
        'src/terminals/TerminalStore.ts': '',
        'src/terminals/store.ts': '',
        'src/native-harness/HarnessRun.ts': '',
        'src/core/threadFiles/ThreadRows.ts': '',
      }),
    ).toEqual(['F2 native-harness/HarnessRun.ts', 'F2 terminals/TerminalStore.ts']);
  });

  it('F3 finds a one-word plural stem over its lines, carries no value, and lets a card-declared exact path stand; F4 counts lines outside imports and carries them', () => {
    const value = params({
      F3: { lines: 3, excluded: [{ path: 'checkouts/rows.ts', subject: 'the rows', why: 'named for its class' }] },
      F4: { lines: 4, allowances: [{ path: 'big/one.ts', lines: 10, why: 'one subject' }] },
    });
    const imports = "import { a } from './a';\nimport {\n  b,\n} from './b';\n";
    const violations = found(value, {
      'src/work/Tasks.ts': `${imports}${lines(5)}`,
      'src/checkouts/rows.ts': lines(5),
      'src/work/status.ts': lines(5),
      'src/work/Task.ts': `${imports}${lines(2)}`,
      'src/big/one.ts': lines(9),
    });
    expect(violations.map(({ fingerprint, value: held }) => [fingerprint, held]).sort()).toEqual([
      ['F3 work/Tasks.ts', undefined],
      ['F4 checkouts/rows.ts', 5],
      ['F4 work/Tasks.ts', 5],
      ['F4 work/status.ts', 5],
    ]);
    expect(violations.find(({ fingerprint }) => fingerprint === 'F4 work/status.ts')?.fix).toContain(
      "{ path: 'work/status.ts', lines: 5, why: '<its one subject>' }",
    );
  });

  it('F5 counts a schema and its type once', () => {
    const text = 'export const thingSchema = 1;\nexport type Thing = number;\nexport const a = 1;\nexport const b = 1;\n';
    expect(found(params({ F5: { exports: 3 } }), { 'src/x.ts': text }).map(({ value }) => value)).toEqual([3]);
    expect(found(params({ F5: { exports: 4 } }), { 'src/x.ts': text })).toEqual([]);
  });

  it('F6 names each file of a wide directory as one place, and F7 each file sharing a stem outside distinct concept directories', () => {
    const texts = {
      'src/a/one.ts': '',
      'src/a/two.ts': '',
      'src/a/three.ts': '',
      'src/a/x/store.ts': '',
      'src/a/store.ts': '',
      'src/b/store.ts': '',
      'src/a/t.test.ts': '',
    };
    expect(prints(params({ F6: { files: 3 }, F7: { exempt: [] } }), texts)).toEqual([
      'F6 a/ @ a/one.ts',
      'F6 a/ @ a/store.ts',
      'F6 a/ @ a/three.ts',
      'F6 a/ @ a/two.ts',
      'F7 a:store @ a/store.ts',
      'F7 a:store @ a/x/store.ts',
    ]);
    const concepts = { 'src/e/terminals/store.ts': '', 'src/e/commands/store.ts': '' };
    expect(prints(params({ F7: { exempt: [] } }, { modules: [{ id: 'e', territory: ['e/'] }] }), concepts)).toEqual([]);
  });

  it('F6 and F7 refuse a file added to a wide directory or a duplicated stem in debt, and not the files already there', () => {
    const value = params({ F6: { files: 2 }, F7: { exempt: [] } });
    const base = { 'src/a/one.ts': '', 'src/a/two.ts': '', 'src/a/three.ts': '', 'src/a/store.ts': '', 'src/a/x/store.ts': '' };
    const debt = found(value, base).map(({ fingerprint }) => fingerprint);
    expect(fresh(value, base, { ...base, 'src/a/four.ts': '', 'src/a/y/store.ts': '' }, debt)).toEqual([
      'F6 a/ @ a/four.ts',
      'F7 a:store @ a/y/store.ts',
    ]);
    expect(fresh(value, base, { ...base, 'src/a/one.ts': 'export const edited = 1;\n' }, [])).toEqual([]);
  });
});

describe('names: symbols', () => {
  it('S1 counts semantic words; S2 allows the prefix only beside the same name imported from the kernel', () => {
    const value = params({ S1: { words: 4, exempt: [] }, S2: { prefix: 'Tagma', kernel: ['@acme/agent'], exempt: [] } });
    const text = [
      "import type { ThreadRow } from '@acme/agent/thread';",
      'export type TagmaThreadRow = ThreadRow;',
      'export type TagmaTool = 1;',
      'export const readAllOpenRows = 1;',
      'export const TAGMA_HOME = 1;',
      '',
    ].join('\n');
    expect(prints(value, { 'src/x.ts': text })).toEqual(['S1 x.ts#readAllOpenRows', 'S2 x.ts#TagmaTool']);
    expect(found(value, { 'src/x.ts': text }).find(({ fingerprint }) => fingerprint === 'S2 x.ts#TagmaTool')?.fix).toContain('`Tool`');
  });

  it('S3, S8 and S9 read heritage through its import, an alias or a namespace included', () => {
    const value = params({
      S3: { suffixes: ['Owner'], exempt: [] },
      S8: { conditions: ['Refused'], names: [], exempt: [] },
      S9: { id: 'tagma/{module}/{name}', suffixes: ['Owner'], testing: [], exempt: [] },
    });
    const texts = {
      'src/a/k.ts':
        "import { Context as C } from 'effect';\nexport class ThingOwner extends C.Service<ThingOwner, { readonly a: 1 }>()('tagma/a/ThingOwner') {}\n",
      'src/a/e.ts': "import { TaggedError } from 'effect/Data';\nexport class StoreBroke extends TaggedError('StoreBroke')<{}> {}\n",
      'src/a/n.ts': "import * as Data from 'effect/Data';\nexport class GoneRefused extends Data.TaggedError('Went')<{}> {}\n",
    };
    expect(prints(value, texts)).toEqual([
      'S3 a/k.ts#ThingOwner',
      'S8 a/e.ts#StoreBroke:condition',
      'S8 a/n.ts#GoneRefused:tag',
      'S9 a/k.ts#ThingOwner:suffix',
    ]);
  });

  it('S3 finds a service key ending in Owner; S5 a generic head unless allowed where it stands', () => {
    const value = params({
      S3: { suffixes: ['Owner', 'Owners'], exempt: [] },
      S5: { heads: ['Manager', 'Handler'], allows: [{ head: 'Handler', in: ['http/**'] }], exempt: [] },
    });
    const service = "export class GrantsOwner extends Context.Service<GrantsOwner, {}>()('x') {}\nexport class RowOwner {}\n";
    expect(
      prints(value, {
        'src/a/grants.ts': service,
        'src/a/jobs.ts': 'export class JobManager {}\n',
        'src/http/h.ts': 'export const PageHandler = 1;\n',
        'src/a/h.ts': 'export const PageHandler = 1;\n',
      }),
    ).toEqual(['S3 a/grants.ts#GrantsOwner', 'S5 a/h.ts#PageHandler', 'S5 a/jobs.ts#JobManager']);
  });

  it('S4 names each declaring file of a duplicated type name as one place, within a module or across the region, by the modules its territories draw', () => {
    const texts = {
      'src/a/one.ts': 'export type Row = 1;\n',
      'src/b/two.ts': 'export interface Row { a: 1 }\n',
      'src/c/three.ts': 'export type Row = 2;\nexport type Only = 1;\n',
    };
    const modules = [{ id: 'store', territory: ['a/', 'b/'] }];
    expect(prints(params({ S4: { within: 'module', exempt: [] } }, { modules }), texts)).toEqual([
      'S4 store:Row @ a/one.ts',
      'S4 store:Row @ b/two.ts',
    ]);
    expect(prints(params({ S4: { within: 'region', exempt: [] } }, { modules }), texts)).toEqual([
      'S4 Row @ a/one.ts',
      'S4 Row @ b/two.ts',
      'S4 Row @ c/three.ts',
    ]);
  });

  it('S4 refuses a new declaration of a duplicated name in debt — in an existing file, a new file, or by renaming another declaration — and not the places already in debt', () => {
    const value = params({ S4: { within: 'module', exempt: [] } });
    const base = {
      'src/store/one.ts': 'export type Row = { a: 1 };\n',
      'src/store/three.ts': 'export type Row = { c: 1 };\n',
      'src/store/two.ts': 'export type Old = { b: 1 };\n',
    };
    const debt = found(value, base).map(({ fingerprint }) => fingerprint);
    expect(debt.sort()).toEqual(['S4 store:Row @ store/one.ts', 'S4 store:Row @ store/three.ts']);
    expect(fresh(value, base, { ...base, 'src/store/two.ts': 'export type Old = { b: 1 };\nexport type Row = { b: 2 };\n' }, debt)).toEqual(
      ['S4 store:Row @ store/two.ts'],
    );
    expect(fresh(value, base, { ...base, 'src/store/four.ts': 'export type Row = { d: 1 };\n' }, debt)).toEqual([
      'S4 store:Row @ store/four.ts',
    ]);
    expect(fresh(value, base, { ...base, 'src/store/two.ts': 'export type Row = { b: 1 };\n' }, debt)).toEqual([
      'S4 store:Row @ store/two.ts',
    ]);
    expect(fresh(value, base, { ...base, 'src/store/two.ts': 'export type Row = { b: 1 };\n' })).toEqual(['S4 store:Row @ store/two.ts']);
  });

  it('S4 reads the files a changed name is mentioned in, never every file of the module, when the tree answers mentions', () => {
    const texts: Record<string, string> = { 'src/m/row.ts': 'export type Row = 1;\n', 'src/m/other.ts': 'export type Row = 2;\n' };
    for (let at = 0; at < 50; at += 1) texts[`src/m/f${at}.ts`] = `export const f${at} = 1;\n`;
    const read = new Set<string>();
    const watched = tree(texts, {
      read: (path) => {
        read.add(path);
        return texts[path] as string;
      },
      mentions: (words) => new Set(Object.keys(texts).filter((path) => words.some((word) => (texts[path] as string).includes(word)))),
    });
    const reading = inspect(names(params({ S4: { within: 'module', exempt: [] } })), watched, ['src/m/row.ts'], unbounded());
    expect(reading.violations.map(({ fingerprint }) => fingerprint)).toEqual(['S4 m:Row @ m/row.ts']);
    expect([...read].sort()).toEqual(['src/m/other.ts', 'src/m/row.ts']);
  });

  it("S7a finds a retired spelling where its entry places it and a retired compound by pattern, outside its exemptions; S7b a reserved word outside its owner's regions", () => {
    const value = params(
      { S7a: { exempt: [] }, S7b: { exempt: [] } },
      {
        glossary: [
          {
            word: 'standing',
            meaning: 'a block neither resting nor replaced',
            owner: 'graph',
            regions: ['graph/**'],
            reserved: false,
            retired: [
              {
                sense: 'a snapshot',
                spelling: 'Standing',
                at: 'any',
                kinds: [],
                replacement: 'state',
                regions: ['**'],
                exempt: { paths: ['graph/**'], names: ['KeptStanding'] },
              },
              {
                sense: 'a shape',
                spelling: 'Faces',
                at: 'last',
                kinds: ['type'],
                replacement: 'none',
                regions: ['**'],
                exempt: { paths: [], names: [] },
              },
              {
                sense: 'an environment implementation',
                pattern: '^EnvironmentProviders?$',
                kinds: [],
                replacement: 'EnvironmentBackend',
                regions: ['**'],
                exempt: { paths: [], names: [] },
              },
            ],
          },
          { word: 'harness', meaning: 'an agent runtime', owner: 'threads', regions: ['threads/**'], reserved: true, retired: [] },
        ],
      },
    );
    const texts = {
      'src/power/a.ts':
        'export type HostStanding = 1;\nexport type KeptStanding = 1;\nexport type ModelFace = 1;\nexport const ModelFaces = 1;\nexport class EnvironmentProviders {}\nexport class EnvironmentProviderRows {}\n',
      'src/graph/a.ts': 'export type BlockStanding = 1;\n',
      'src/terminals/b.ts': 'export class HarnessHost {}\n',
      'src/threads/c.ts': 'export class HarnessRegistry {}\n',
    };
    expect(prints(value, texts)).toEqual([
      'S7a power/a.ts#EnvironmentProviders:^EnvironmentProviders?$',
      'S7a power/a.ts#HostStanding:Standing',
      'S7a power/a.ts#ModelFace:Faces',
      'S7b terminals/b.ts#HarnessHost:harness',
    ]);
    expect(found(value, texts).find(({ fingerprint }) => fingerprint === 'S7a power/a.ts#HostStanding:Standing')?.fix).toContain('state');
  });

  it('S8 keeps each failure-form defect apart and reads an explicit `_tag`, a record Failure, and leaves a form it cannot read unjudged', () => {
    const value = params({ S8: { conditions: ['Refused', 'Failed', 'Missing'], names: ['GateRefusal'], exempt: [] } });
    const text = [
      "export class RootMissing extends Data.TaggedError('RootMissing')<{}> {}",
      "export class StoreError extends Data.TaggedError('Store')<{}> {}",
      'export class SpawnFailure extends Error {}',
      "export class ReadFailed extends Error { readonly _tag = 'Wrong'; }",
      'export type ThreadFailed = RootMissing | ReadFailed;',
      'export type ReadFailure = { broken: true };',
      "export type TargetRefusal = 'gone' | TerminalRefused | TerminalUnavailable;",
      "export type CodeRefusal = 'gone' | 'held';",
      'export class GateRefusal {}',
      'export type CountRefusal = typeof counts.Type;',
      '',
    ].join('\n');
    const reading = inspect(names(value), tree({ 'src/x.ts': text }), ['src/x.ts'], unbounded());
    expect(reading.violations.map(({ fingerprint }) => fingerprint).sort()).toEqual([
      'S8 x.ts#ReadFailed:tag',
      'S8 x.ts#ReadFailure:union',
      'S8 x.ts#SpawnFailure:condition',
      'S8 x.ts#SpawnFailure:union',
      'S8 x.ts#StoreError:condition',
      'S8 x.ts#StoreError:tag',
      'S8 x.ts#TargetRefusal:union',
      'S8 x.ts#ThreadFailed:class',
    ]);
    expect(reading.unjudged.map(({ line }) => line)).toEqual([10]);
  });

  it('S8 judges a Refusal or Failure written through a same-file const or a schema, and leaves one it cannot establish unjudged', () => {
    const value = params({ S8: { conditions: ['Refused'], names: [], exempt: [] } });
    const text = [
      "import { Schema } from 'effect';",
      "import type { OPERATIONS, OperationId } from './operations';",
      "import { rolloutRefusal } from './journal';",
      "export const LISTING = ['bad-cursor', 'cursor-stale'] as const;",
      'export type ListingRefusal = (typeof LISTING)[number];',
      "const TITLES = { 'empty-answer': 'The model returned nothing.' } as const;",
      'export type TitleFailure = keyof typeof TITLES;',
      'export const FinishRefusal = Schema.Struct({ code: Schema.String });',
      'export type FinishRefusal = typeof FinishRefusal.Type;',
      'export type RolloutRefusal = typeof rolloutRefusal.$inferSelect;',
      "export const VerdictFailure = Schema.Union([Schema.Struct({ _tag: Schema.Literal('Gone') })]).pipe(Schema.toTaggedUnion('_tag'));",
      'export type VerdictFailure = typeof VerdictFailure.Type;',
      "export type EveryRefusal = (typeof OPERATIONS)[OperationId]['refusals'][number];",
      'export const Mapped = Schema.Union([Schema.Struct({ a: Schema.String })]).pipe(Schema.mapFields((fields) => fields));',
      'export type MappedFailure = typeof Mapped.Type;',
      '',
    ].join('\n');
    const reading = inspect(names(value), tree({ 'src/x.ts': text }), ['src/x.ts'], unbounded());
    expect(reading.violations.map(({ fingerprint }) => fingerprint).sort()).toEqual([
      'S8 x.ts#FinishRefusal:union',
      'S8 x.ts#RolloutRefusal:union',
      'S8 x.ts#VerdictFailure:union',
    ]);
    expect(reading.unjudged.map(({ line }) => line)).toEqual([13, 15]);
  });

  it('S8 limits an explicit unknown to its named declaration, leaving the same form elsewhere unjudged', () => {
    const value = params({
      S8: {
        conditions: ['Refused'],
        names: [],
        notJudged: [{ path: 'platform/body.ts', name: 'EveryRefusal', why: 'cross-file catalog' }],
        exempt: [],
      },
    });
    const alias = "export type EveryRefusal = (typeof OPERATIONS)[OperationId]['refusals'][number];\n";
    const reading = inspect(
      names(value),
      tree({ 'src/platform/body.ts': alias, 'src/platform/other.ts': alias }),
      ['src/platform/body.ts', 'src/platform/other.ts'],
      unbounded(),
    );
    expect(reading.unjudged.map(({ file }) => file)).toEqual(['src/platform/other.ts']);
  });

  it('S9 derives the id from the module, names shared ids, refuses an application shape — a namespace import and a private one included — reads non-exported keys, and an exported class implementing a shape outside testing', () => {
    const value = params({ S9: { id: 'tagma/{module}/{name}', suffixes: ['Owner', 'Faces'], testing: ['**/*Fixture.ts'], exempt: [] } });
    const texts = {
      'src/graph/doctor.ts':
        "export class Doctor extends Context.Service<Doctor, { readonly run: () => void }>()('tagma/graph/Doctor') {}\n",
      'src/graph/sources.ts':
        "import type { SourcesShape } from '../elsewhere/shapes';\nexport class Sources extends Context.Service<Sources, SourcesShape>()('tagma/graph/Sources') {}\n",
      'src/graph/spaced.ts':
        "import * as Shapes from './shapes';\nexport class Spaced extends Context.Service<Spaced, Shapes.Shape>()('tagma/graph/Spaced') {}\n",
      'src/graph/private.ts':
        "type Own = { readonly a: 1 };\nexport class Private extends Context.Service<Private, Own>()('tagma/graph/Private') {}\n",
      'src/graph/library.ts':
        "import type { Shape } from '@acme/kit';\nexport class Library extends Context.Service<Library, Shape>()('tagma/graph/Library') {}\n",
      'src/graph/hidden.ts': "class Hidden extends Context.Service<Hidden, {}>()('wrong') {}\nexport const use = Hidden;\n",
      'src/http/copy.ts': "export class Doctor extends Context.Service<Doctor, {}>()('tagma/graph/Doctor') {}\n",
      'src/graph/impl.ts': 'export class Impl implements Context.Service.Shape<typeof Doctor> {}\n',
      'src/graph/implFixture.ts': 'export class Impl implements Context.Service.Shape<typeof Doctor> {}\n',
    };
    expect(prints(value, texts)).toEqual([
      'S9 graph/doctor.ts#Doctor:shared',
      'S9 graph/hidden.ts#Hidden:id',
      'S9 graph/impl.ts#Impl:implements',
      'S9 graph/private.ts#Private:shape',
      'S9 graph/sources.ts#Sources:shape',
      'S9 graph/spaced.ts#Spaced:shape',
      'S9 http/copy.ts#Doctor:id',
      'S9 http/copy.ts#Doctor:shared',
    ]);
  });

  it('S9 lets keys over one generic contract of their module, instantiated with a type argument, keep that named contract', () => {
    const value = params(
      { S9: { id: 'tagma/{module}/{name}', suffixes: ['Owner'], testing: [], exempt: [] } },
      {
        modules: [
          { id: 'platform', territory: ['platform/'] },
          { id: 'graph', territory: ['graph/'] },
        ],
      },
    );
    const texts = {
      'src/platform/store.ts': [
        "export type Store<Brand extends 'machine' | 'graph'> = { readonly brand: Brand };",
        "export class MachineStore extends Context.Service<MachineStore, Store<'machine'>>()('tagma/platform/MachineStore') {}",
        'export type Plain = { readonly a: 1 };',
        "export class PlainStore extends Context.Service<PlainStore, Plain>()('tagma/platform/PlainStore') {}",
        'export type Boxed = { readonly a: 1 };',
        "export class BoxedStore extends Context.Service<BoxedStore, Boxed<'x'>>()('tagma/platform/BoxedStore') {}",
        '',
      ].join('\n'),
      'src/platform/units.ts':
        "import type { Units } from '../graph/units';\nexport class MachineUnits extends Context.Service<MachineUnits, Units<'machine'>>()('tagma/platform/MachineUnits') {}\n",
      'src/graph/units.ts': 'export type Units<Brand> = { readonly brand: Brand };\n',
      'src/platform/twice.ts':
        "export interface Twice<A> { readonly a: A }\nexport class TwiceKey extends Context.Service<TwiceKey, Twice<1>>()('tagma/platform/TwiceKey') {}\n",
      'src/platform/twiceAgain.ts': 'export type Twice<A> = { readonly a: A };\n',
    };
    expect(prints(value, texts).filter((one) => one.endsWith(':shape'))).toEqual([
      'S9 platform/store.ts#BoxedStore:shape',
      'S9 platform/store.ts#PlainStore:shape',
      'S9 platform/twice.ts#TwiceKey:shape',
      'S9 platform/units.ts#MachineUnits:shape',
    ]);
  });

  it('S9 refuses a new id defect on a key whose base shape defect stands in debt', () => {
    const value = params({ S9: { id: 'tagma/{module}/{name}', suffixes: ['Owner'], testing: [], exempt: [] } });
    const base = { 'src/m/x.ts': "export type Shape = { a: 1 };\nexport class X extends Context.Service<X, Shape>()('tagma/m/X') {}\n" };
    const debt = found(value, base).map(({ fingerprint }) => fingerprint);
    expect(debt).toEqual(['S9 m/x.ts#X:shape']);
    expect(
      fresh(value, base, { 'src/m/x.ts': "export class X extends Context.Service<X, { a: 1 }>()('tagma/other/X') {}\n" }, debt),
    ).toEqual(['S9 m/x.ts#X:id']);
  });

  it("S10 counts the distinct words of a service shape's members besides its own and the verbs; S11 finds a published name in the present", () => {
    const shape = '{ readonly readTerminal: 1; readonly custody: 1; readonly pendingNotices: 1; readonly screens: 1; readonly stop: 1 }';
    const value = params({ S10: { nouns: 3, verbs: ['read', 'stop'], exempt: [] }, S11: { participles: ['Held'], exempt: [] } });
    const texts = {
      'src/a/terminals.ts': `export class Terminals extends Context.Service<Terminals, ${shape}>()('x') {}\n`,
      'src/a/bus.ts':
        'export const one = PubSub.unbounded<ThreadMoved>();\nexport const two = PubSub.unbounded<RunHeld>();\nexport const three = PubSub.unbounded<StartRun>();\n',
    };
    expect(
      found(value, texts)
        .map(({ fingerprint, value: held }) => [fingerprint, held])
        .sort(),
    ).toEqual([
      ['S10 a/terminals.ts#Terminals', 4],
      ['S11 a/bus.ts#StartRun', undefined],
    ]);
  });

  it('literals finds a catalog tag in a tag position of its region, counts repeats in one entry, and leaves allowed files and roles alone', () => {
    const value = params({
      literals: [{ region: ['graph/**'], words: ['task', 'claim'], positions: ['compare', 'argument'], allowIn: ['graph/catalog/**'] }],
    });
    const texts = {
      'src/graph/brief.ts': "if (row.tag === 'task') {}\nif (other.tag === 'task') {}\ntable.hasRole(row, 'claim');\n",
      'src/graph/catalog/own.ts': "if (row.tag === 'task') {}\n",
      'src/http/x.ts': "if (row.tag === 'task') {}\n",
    };
    expect(found(value, texts).map(({ fingerprint, value: held }) => [fingerprint, held])).toEqual([
      ["literal graph/brief.ts 'task' compare", 2],
    ]);
  });
});

describe('names: region and envelope', () => {
  it('reads no file under an uncovered path or outside base', () => {
    const value = params({ F4: { lines: 1, allowances: [] } }, { uncovered: [{ path: 'src/later/', until: 'its card' }] });
    expect(prints(value, { 'src/later/a.ts': lines(3), 'lib/a.ts': lines(3), 'src/now.ts': lines(3) })).toEqual(['F4 now.ts']);
  });

  it('refuses a reading that reaches more files than its envelope, and never answers it clean; a judgement spends one budget over both sides', () => {
    const texts = { 'src/a.ts': '', 'src/b.ts': '', 'src/c.ts': '' };
    const value = params({ F4: { lines: 1, allowances: [] } });
    const capped = (files: number) => budgetOf('names', deriveCalibration(ASK_BUDGET_MS / files, 1, 1024 * 1024));
    expect(() => readNames(value, tree(texts), Object.keys(texts), ADAPTERS, capped(2))).toThrow(EnvelopeExceeded);
    const shared = capped(5);
    readNames(value, tree(texts), Object.keys(texts), ADAPTERS, shared);
    expect(() => readNames(value, tree(texts), Object.keys(texts), ADAPTERS, shared)).toThrow(EnvelopeExceeded);
  });
});

describe('judge: names', () => {
  const budget = params({
    F3: { lines: 2, excluded: [] },
    F4: { lines: 4, allowances: [] },
    S2: { prefix: 'Tagma', kernel: [], exempt: [] },
  });

  it('lets a file in debt grow or shrink, and refuses a file that newly crosses the F4 budget', () => {
    const base = { 'src/big.ts': `import { a } from './a';\n${lines(6)}`, 'src/work/Tasks.ts': lines(3) };
    const debt = found(budget, base).map(({ fingerprint }) => fingerprint);
    expect(fresh(budget, base, { ...base, 'src/big.ts': `import { a } from './a';\n${lines(9)}` }, debt)).toEqual([]);
    expect(fresh(budget, base, { ...base, 'src/big.ts': lines(5) }, debt)).toEqual([]);
    expect(fresh(budget, base, { ...base, 'src/work/Tasks.ts': lines(5) }, debt)).toEqual(['F4 work/Tasks.ts']);
  });

  it('carries a file moved with only its imports changed and answers the pair, and refuses an unrelated arrival that takes a deleted file’s name or place', () => {
    const base = { 'src/a/big.ts': `import { x } from './x';\n${lines(6)}`, 'src/a/row.ts': 'export type TagmaRow = 1;\n' };
    const debt = found(budget, base).map(({ fingerprint }) => fingerprint);
    const moved = judged(
      budget,
      base,
      {
        'src/b/big.ts': `import { x } from '../a/x';\n${lines(6)}`,
        'src/b/row.ts': 'export type TagmaRow = 1;\n',
        'src/b/new.ts': lines(5),
      },
      debt,
    );
    expect(moved.violations.map(({ fingerprint }) => fingerprint)).toEqual(['F4 b/new.ts']);
    expect(moved.followed).toEqual([
      { from: 'F4 a/big.ts', to: 'F4 b/big.ts' },
      { from: 'S2 a/row.ts#TagmaRow', to: 'S2 b/row.ts#TagmaRow' },
    ]);
    expect(
      fresh(budget, base, { 'src/a/big.ts': base['src/a/big.ts'], 'src/c/q.ts': 'export class TagmaRow { run() {} }\n' }, debt),
    ).toEqual(['S2 c/q.ts#TagmaRow']);
    expect(fresh(budget, base, { 'src/a/row.ts': base['src/a/row.ts'], 'src/c/big.ts': lines(6, 'w') }, debt)).toEqual(['F4 c/big.ts']);
  });

  it('refuses a moved file that grew or whose body also changed', () => {
    const base = { 'src/a/big.ts': lines(6) };
    const debt = ['F4 a/big.ts'];
    expect(fresh(budget, base, { 'src/b/big.ts': `${lines(6)}\nexport const more = 1;` }, debt)).toEqual(['F4 b/big.ts']);
    expect(fresh(budget, base, { 'src/b/big.ts': lines(6).replace('v0 ', 'first ') }, debt)).toEqual(['F4 b/big.ts']);
  });

  it('judges a change that repairs a base file which does not parse on the built side alone', () => {
    expect(fresh(budget, { 'src/x.ts': 'const = ;\n' }, { 'src/x.ts': 'export type TagmaX = 1;\n' })).toEqual(['S2 x.ts#TagmaX']);
  });
});
