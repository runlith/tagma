import { describe, expect, it } from 'bun:test';
import { DECLARATIONS, NAMES, parseFacet } from '../../adapter';
import { UnsupportedSource } from '../../imports';
import { ADAPTERS, scriptsOf } from '../adapters';
import { outline as outlineOf, outlineWithSites as outlineWithSitesOf } from './declarations';

const outline = (text: string, path: string) => outlineOf(text, path, scriptsOf);
const outlineWithSites = (text: string, path: string) => outlineWithSitesOf(text, path, scriptsOf);
const read = (text: string, path = 'src/a.ts') => outline(text, path);

describe('js declarations', () => {
  it('keeps a local exported only under another name among the declarations', () => {
    const text = 'const local = 1;\nexport { local as renamed };\nconst both = 2;\nexport { both, both as again };\n';
    expect(
      parseFacet(ADAPTERS, DECLARATIONS, text, 'src/a.ts').map(({ name, exported }) => `${exported ? 'export' : 'local'} ${name}`),
    ).toEqual(['export renamed', 'export both', 'export again', 'local local']);
  });

  it('lists the names a file imports beside those it declares, with the module each comes from', () => {
    const text =
      "import {\n  Effect,\n  Layer as L,\n} from 'effect';\nimport * as Schema from 'effect/Schema';\nimport Legacy = require('legacy');\nexport const own = 1;\n";
    const { declarations, imports } = parseFacet(ADAPTERS, NAMES, text, 'src/a.ts');
    expect(declarations.map(({ name, line }) => `${name}:${line}`)).toEqual(['own:7']);
    expect(imports.map(({ name, line, from, imported }) => `${name}:${line} ${from} ${imported}`)).toEqual([
      'Effect:2 effect Effect',
      'L:3 effect Layer',
      'Schema:5 effect/Schema *',
      'Legacy:6 legacy =',
    ]);
  });

  it('answers each declaration the module exports itself, with the heritage, tag, shape and members a naming rule reads', () => {
    const facts = read(
      [
        "import { Context, Data } from 'effect';",
        "import type { Shape } from './shape';",
        "export class Doctor extends Context.Service<Doctor, { readonly run: () => void; readonly read: number }>()('tagma/graph/Doctor') {}",
        "export class Named extends Context.Service<Named, Shape>()('tagma/graph/Named') {}",
        "export class Gone extends Data.TaggedError('Went')<{ readonly at: string }> {}",
        'export class Impl implements Context.Service.Shape<typeof Doctor> { run() {} private hidden = 1; }',
        "export type Refusal = 'a' | 'b' | OtherRefused | { readonly code: string };",
        'const local = 1;',
        'export { local as renamed };',
        "export * from './elsewhere';",
        "import { forwarded } from './x';",
        'export { forwarded };',
        '',
      ].join('\n'),
    );
    expect(facts.exports.map(({ name, kind }) => `${kind} ${name}`)).toEqual([
      'class Doctor',
      'class Named',
      'class Gone',
      'class Impl',
      'type Refusal',
      'variable renamed',
    ]);
    const [doctor, named, gone, impl, refusal] = facts.exports;
    expect(doctor).toMatchObject({
      extends: 'Context.Service',
      tag: 'tagma/graph/Doctor',
      shape: { written: 'inline', members: ['run', 'read'] },
      line: 3,
    });
    expect(named?.shape).toEqual({ written: 'named', name: 'Shape', qualified: false, arguments: 0 });
    expect(gone).toMatchObject({ extends: 'Data.TaggedError', tag: 'Went' });
    expect(impl).toMatchObject({ implements: ['Context.Service.Shape'], members: ['run'] });
    expect(refusal?.union).toEqual({ literals: 2, references: ['OtherRefused'], records: 1, queries: [], other: 0 });
    expect(facts.bindings).toContainEqual({ local: 'Shape', imported: 'Shape', specifier: './shape', line: 2 });
    expect(facts.lines).toBe(12);
  });

  it('reads a type alias through a same-file const: frozen string arrays and object keys as literals, a schema query with the call that made it, anything else as unread', () => {
    const facts = read(
      [
        "import { Schema } from 'effect';",
        "export const CODES = ['gone', 'held'] as const;",
        "export const WIDE = ['gone', 'held'] as readonly string[];",
        "const LOOSE = ['gone'];",
        "const TEXTS = { 'empty-answer': 'x', tool: 'y' };",
        'export const Row = Schema.Struct({ code: Schema.String });',
        "export const Either = Schema.Union([Schema.Struct({ _tag: Schema.Literal('A') }), Other]).pipe(Schema.toTaggedUnion('_tag'));",
        'export type Code = (typeof CODES)[number];',
        'export type Wide = (typeof WIDE)[number] | (typeof LOOSE)[number];',
        'export type Text = keyof typeof TEXTS;',
        'export type RowOf = typeof Row.Type | typeof table.$inferSelect;',
        'export type EitherOf = typeof Either.Type;',
        "export type Every = (typeof OPERATIONS)[Id]['refusals'][number];",
        '',
      ].join('\n'),
    );
    const union = (name: string) => facts.exports.find((one) => one.name === name)?.union;
    expect(union('Code')).toEqual({ literals: 2, references: [], records: 0, queries: [], other: 0 });
    expect(union('Wide')).toEqual({ literals: 0, references: [], records: 0, queries: [], other: 2 });
    expect(union('Text')).toMatchObject({ literals: 2, other: 0 });
    expect(union('RowOf')?.queries).toEqual([
      { of: 'Row', member: 'Type', made: { callee: 'Schema.Struct', arms: [], pipes: [] } },
      { of: 'table', member: '$inferSelect' },
    ]);
    expect(union('EitherOf')?.queries).toEqual([
      {
        of: 'Either',
        member: 'Type',
        made: {
          callee: 'Schema.Union',
          arms: [{ callee: 'Schema.Struct', arms: [], pipes: [] }, undefined],
          pipes: ['Schema.toTaggedUnion'],
        },
      },
    ]);
    expect(union('Every')).toMatchObject({ queries: [], other: 1 });
  });

  it('answers whether a contract is generic and how many type arguments a named shape passes it', () => {
    const facts = read(
      [
        'export type Store<Brand> = { readonly brand: Brand };',
        'export interface Units<Brand> { readonly brand: Brand }',
        'export type Plain = { readonly a: 1 };',
        "export class MachineStore extends Context.Service<MachineStore, Store<'machine'>>()('tagma/platform/MachineStore') {}",
        '',
      ].join('\n'),
    );
    expect(facts.exports.map((one) => [one.name, one.generic === true])).toEqual([
      ['Store', true],
      ['Units', true],
      ['Plain', false],
      ['MachineStore', false],
    ]);
    expect(facts.exports[3]?.shape).toEqual({ written: 'named', name: 'Store', qualified: false, arguments: 1 });
  });

  it('keeps the same body digest when only import and re-export statements change', () => {
    const body = 'export const value = 1;\nexport function run() { return value; }\n';
    const one = read(`import { a } from './a';\n${body}`);
    const moved = read(`import { a } from '../far/a';\nexport * from './b';\n${body}`);
    const edited = read(`import { a } from './a';\n${body}export const more = 2;\n`);
    expect(moved.body).toBe(one.body);
    expect(edited.body).not.toBe(one.body);
  });

  it('answers string literals in tag positions, a local parameter named for a tag among them, and leaves a role lookup alone', () => {
    const facts = read(
      [
        "if (block.tag === 'task') {}",
        "switch (row.tag) { case 'claim': break; }",
        "hasTag(block, 'decision');",
        "const made = { tags: ['idea'] };",
        "byTag['rule'];",
        'const live = (tagId: string) => tagId;',
        "live('area');",
        "table.hasRole(row, 'claim');",
        "table.tagsWithRole('claim');",
        '',
      ].join('\n'),
    );
    expect(facts.literals.map(({ value, position }) => `${position} ${value}`).sort()).toEqual([
      'argument area',
      'argument decision',
      'compare claim',
      'compare task',
      'lookup rule',
      'property idea',
    ]);
  });

  it('answers the element type a PubSub publishes', () => {
    const facts = read(
      "import { PubSub } from 'effect';\nexport const bus = PubSub.unbounded<ThreadMoved>();\nlet held: PubSub.PubSub<RunEnding>;\n",
    );
    expect(facts.published.map(({ name }) => name).sort()).toEqual(['RunEnding', 'ThreadMoved']);
  });

  it('exports only from the module script of a Svelte component', () => {
    const facts = outline(
      '<script module lang="ts">\nexport const shared = 1;\n</script>\n<script lang="ts">\nexport let prop = 2;\n</script>\n',
      'src/View.svelte',
    );
    expect(facts.exports.map(({ name, line }) => ({ name, line }))).toEqual([{ name: 'shared', line: 2 }]);
  });

  it('counts the lines import statements take, reads non-exported declarations and an explicit `_tag`, and answers import sites from the same parse', () => {
    const text = [
      'import {',
      '  a,',
      "} from './a';",
      "import type { B } from './b';",
      "class Hidden extends Context.Service<Hidden, {}>()('tagma/x/Hidden') {}",
      "export class ReadFailed extends Error { readonly _tag = 'Wrong' as const; }",
      'type Own = { readonly a: 1 };',
      '',
    ].join('\n');
    const both = outlineWithSites(text, 'src/a.ts');
    expect(both.value.importLines).toBe(4);
    expect(both.value.locals.map(({ name, kind }) => `${kind} ${name}`)).toEqual(['class Hidden', 'type Own']);
    expect(both.value.exports.find(({ name }) => name === 'ReadFailed')?.tag).toBe('Wrong');
    expect(both.sites.map(({ specifier }) => specifier)).toEqual(['./a', './b']);
    expect(both.value).toEqual(outline(text, 'src/a.ts'));
  });

  it('refuses a text that does not parse, naming its line', () => {
    expect(() => read('export const ok = 1;\nconst = ;\n')).toThrow(UnsupportedSource);
  });
});
