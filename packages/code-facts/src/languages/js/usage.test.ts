import { describe, expect, it } from 'bun:test';
import { UnsupportedSource } from '../../imports';
import { blobTree, facetHeld, type FacetMemo } from '../../blobs';
import { facetOf } from '../../tree';
import { js, scriptsOf } from '../adapters';
import { USAGE } from './index';
import { usage as usageOf } from './usage';

const usage = (text: string, path: string) => usageOf(text, path, scriptsOf);

const top = (text: string, name: string, path = 'src/a.ts') => {
  const found = usage(text, path);
  const one = found.tops.find((top) => top.name === name);
  if (one === undefined) throw new Error(`no top ${name}`);
  return { found, one };
};

describe('js usage', () => {
  it('reads an operation definition with its id, answer keys and nested calls', () => {
    const { found, one } = top("export const op = operation('greet', { answer: arms('hi') });\n", 'op');
    expect(one.exported).toBe(true);
    expect(one.references).toEqual(expect.arrayContaining(['operation', 'arms']));
    const operation = one.calls.find(({ callee }) => callee === 'operation');
    expect(operation).toMatchObject({ first: 'greet', keys: ['answer'], kind: 'call', owner: 'op', line: 1 });
    expect(one.calls.some(({ callee, owner }) => callee === 'arms' && owner === 'op')).toBe(true);
    expect(found.calls.some(({ callee, first }) => callee === 'operation' && first === 'greet')).toBe(true);
  });

  it('reads pair and manifest registrations with member references', () => {
    const text = ['export const p = pair(OPS.id, body(2));', 'export const M = manifest({ operations: Object.values(PAIRS) });', ''].join(
      '\n',
    );
    const read = usage(text, 'src/a.ts');
    const pair = read.calls.find(({ callee }) => callee === 'pair');
    expect(pair).toMatchObject({ kind: 'call', owner: 'p', keys: [], first: 'OPS.id' });
    expect(read.calls.some(({ callee, owner }) => callee === 'body' && owner === 'p')).toBe(true);
    const paired = read.tops.find(({ name }) => name === 'p');
    expect(paired?.references).toEqual(expect.arrayContaining(['OPS.id', 'pair', 'body']));
    const manifest = read.calls.find(({ callee }) => callee === 'manifest');
    expect(manifest).toMatchObject({ kind: 'call', owner: 'M', keys: ['operations'] });
    expect(manifest?.first).toBeUndefined();
    expect(manifest?.properties?.map(({ key }) => key)).toEqual(['operations']);
    const operations = manifest?.properties?.find(({ key }) => key === 'operations');
    expect(operations?.references).toEqual(expect.arrayContaining(['Object.values', 'PAIRS']));
    expect(operations?.calls.some(({ callee, first }) => callee === 'Object.values' && first === 'PAIRS')).toBe(true);
  });

  it('keeps only the operations property as the registration root', () => {
    const text = "export const M = manifest({ operations: [PAIRS.one], tables: ['t'] });\n";
    const manifest = usage(text, 'src/a.ts').calls.find(({ callee }) => callee === 'manifest');
    expect(manifest?.keys).toEqual(['operations', 'tables']);
    expect(manifest?.properties?.map(({ key }) => key)).toEqual(['operations', 'tables']);
    const operations = manifest?.properties?.find(({ key }) => key === 'operations');
    const tables = manifest?.properties?.find(({ key }) => key === 'tables');
    expect(operations?.references).toEqual(expect.arrayContaining(['PAIRS.one']));
    expect(operations?.calls).toEqual([]);
    expect(tables?.references).toEqual([]);
    const values = usage('export const M = manifest({ operations: Object.values(PAIRS), tables: [] });\n', 'src/a.ts').calls.find(
      ({ callee }) => callee === 'manifest',
    );
    expect(values?.properties?.find(({ key }) => key === 'operations')?.calls.map(({ callee }) => callee)).toEqual(['Object.values']);
  });

  it('reads a plain-object operations table per entry, distinguishing operation entries via calls', () => {
    const text = [
      'export const X_OPERATIONS = {',
      '  myOp: { params: 1, answer: 2 },',
      "  other: operation('other', { answer: arms(1) }),",
      '} satisfies Record<string, Operation>;',
      '',
    ].join('\n');
    const { one } = top(text, 'X_OPERATIONS');
    expect(one.exported).toBe(true);
    expect(one.entries?.map(({ key }) => key)).toEqual(['myOp', 'other']);
    expect(one.entries?.find(({ key }) => key === 'myOp')).toMatchObject({ keys: ['params', 'answer'] });
    expect(one.entries?.find(({ key }) => key === 'myOp')?.calls).toEqual([]);
    const other = one.entries?.find(({ key }) => key === 'other');
    expect(other?.keys).toEqual([]);
    expect(other?.calls.map(({ callee }) => callee).sort()).toEqual(['arms', 'operation']);
    expect(other?.calls.find(({ callee }) => callee === 'operation')).toMatchObject({
      first: 'other',
      keys: ['answer'],
      owner: 'X_OPERATIONS',
    });
  });

  it('distinguishes new from call and reads only the syntax tree', () => {
    const text = [
      'const mp = new Map<string, Deferred.Deferred<string, Error>>();',
      "const db = new Database('f.db');",
      'const a = Semaphore.make(3);',
      'const b = Latch.make(false);',
      "const c = Bun.spawnSync(['ls']);",
      "import fs from 'node:fs';",
      "fs.readFileSync('x');",
      'const spelled = \'operation("ghost")\';',
      '// pair(OPS.ghost)',
      '/* manifest({ operations: 1 }) */',
      '',
    ].join('\n');
    const read = usage(text, 'src/a.ts');
    const byCallee = (callee: string) => read.calls.filter((call) => call.callee === callee);
    expect(byCallee('Map')[0]).toMatchObject({ kind: 'new', owner: 'mp' });
    expect(byCallee('Database')[0]).toMatchObject({ kind: 'new', first: 'f.db', owner: 'db' });
    expect(byCallee('Semaphore.make')[0]).toMatchObject({ kind: 'call', owner: 'a' });
    expect(byCallee('Latch.make')[0]).toMatchObject({ kind: 'call', owner: 'b' });
    expect(byCallee('Bun.spawnSync')[0]).toMatchObject({ kind: 'call', owner: 'c' });
    expect(byCallee('fs.readFileSync')[0]).toMatchObject({ kind: 'call', first: 'x' });
    expect(read.calls.some(({ callee }) => callee === 'operation' || callee === 'pair' || callee === 'manifest')).toBe(false);
    expect(read.tops.find(({ name }) => name === 'mp')?.references).toEqual(expect.arrayContaining(['Map', 'Deferred.Deferred']));
  });

  it('memoises per blob through blobTree and falls back through facetOf', () => {
    const text = "export const op = operation('id', { answer: arms(1) });\n";
    const objects = new Map([['src/a.ts', 'blob-1']]);
    const texts = new Map([['blob-1', text]]);
    const facets: FacetMemo = new Map();
    const tree = blobTree(objects, texts, new Map(), [js], undefined, facets);
    const first = facetOf(tree, 'src/a.ts', USAGE, [js]);
    expect(first.calls.map(({ callee }) => callee).sort()).toEqual(['arms', 'operation']);
    expect(facets.size).toBe(1);
    expect(facetHeld(facets, [js], USAGE, 'blob-1', 'src/a.ts')).toBe(true);
    expect(facetOf(tree, 'src/a.ts', USAGE, [js])).toBe(first);
    expect(facets.size).toBe(1);
    const bare = { has: () => true, read: () => text };
    expect(facetOf(bare, 'src/a.ts', USAGE, [js])).toEqual(first);
  });

  it('refuses a text that does not parse', () => {
    expect(() => usage('export const ok = 1;\nconst = ;\n', 'src/a.ts')).toThrow(UnsupportedSource);
  });

  it('gives each call an absolute offset so two calls on one line stay distinct', () => {
    const text = "export const both = [operation('one', { answer: arms(1) }), operation('two', { answer: arms(2) })];\n";
    const read = usage(text, 'src/a.ts');
    const operations = read.calls.filter(({ callee }) => callee === 'operation');
    expect(operations).toHaveLength(2);
    expect(operations.map(({ line }) => line)).toEqual([1, 1]);
    expect(operations[0]?.offset).toBe(text.indexOf("operation('one'"));
    expect(operations[1]?.offset).toBe(text.indexOf("operation('two'"));
    expect(operations[0]?.offset).toBeLessThan(operations[1]?.offset ?? 0);
    expect(new Set(operations.map(({ offset }) => offset)).size).toBe(2);
    const top = read.tops.find(({ name }) => name === 'both');
    expect(top?.calls.filter(({ callee }) => callee === 'operation').map(({ offset }) => offset)).toEqual(
      operations.map(({ offset }) => offset),
    );
    expect(new Set(top?.calls.map(({ offset }) => offset)).size).toBe(top?.calls.length ?? 0);
  });

  it('reads operation second-arg answer values without reparsing text', () => {
    const answerOf = (value: string) => {
      const text = `export const op = operation('id', { answer: ${value} });\n`;
      const read = usage(text, 'src/a.ts');
      const operation = read.calls.find(({ callee }) => callee === 'operation');
      return operation?.secondProperties?.find(({ key }) => key === 'answer')?.value;
    };
    expect(answerOf('arms(1)')).toEqual({ form: 'call', callee: 'arms' });
    expect(answerOf('Schema.Unknown')).toEqual({ form: 'member', name: 'Schema.Unknown' });
    expect(answerOf('X.Unknown')).toEqual({ form: 'member', name: 'X.Unknown' });
    expect(answerOf('MySchema')).toEqual({ form: 'identifier', name: 'MySchema' });
    expect(answerOf('undefined')).toEqual({ form: 'undefined' });
    expect(answerOf('void 0')).toEqual({ form: 'void' });
    const missing = usage("export const op = operation('id', { other: 1 });\n", 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(missing?.keys).toEqual(['other']);
    expect(missing?.secondProperties?.some(({ key }) => key === 'answer')).toBe(false);
  });

  it('reads plain-object operations tables with nested answer values and Operation typing', () => {
    const text = [
      'export const X_OPERATIONS = {',
      '  plain: { answer: MySchema },',
      '  called: { answer: arms(1) },',
      '  unknown: { answer: Schema.Unknown },',
      '  missing: { params: 1 },',
      '} satisfies Record<string, Operation>;',
      '',
    ].join('\n');
    const { one } = top(text, 'X_OPERATIONS');
    expect(one.types).toEqual(expect.arrayContaining(['Operation', 'Record']));
    const valueOf = (entry: string) =>
      one.entries?.find(({ key }) => key === entry)?.properties?.find(({ key }) => key === 'answer')?.value;
    expect(valueOf('plain')).toEqual({ form: 'identifier', name: 'MySchema' });
    expect(valueOf('called')).toEqual({ form: 'call', callee: 'arms' });
    expect(valueOf('unknown')).toEqual({ form: 'member', name: 'Schema.Unknown' });
    expect(one.entries?.find(({ key }) => key === 'missing')?.properties?.some(({ key }) => key === 'answer')).toBe(false);
    const annotated = top('export const Y: Record<string, Operation> = { a: { answer: MySchema } };\n', 'Y').one;
    expect(annotated.types).toEqual(expect.arrayContaining(['Operation', 'Record']));
    expect(annotated.entries?.find(({ key }) => key === 'a')?.properties?.find(({ key }) => key === 'answer')?.value).toEqual({
      form: 'identifier',
      name: 'MySchema',
    });
    const casted = top('export const Z = { b: { answer: void 0 } } as Record<string, Operation>;\n', 'Z').one;
    expect(casted.types).toEqual(expect.arrayContaining(['Operation']));
    expect(casted.entries?.find(({ key }) => key === 'b')?.properties?.find(({ key }) => key === 'answer')?.value).toEqual({
      form: 'void',
    });
    expect(top('export const N = { a: 1 };\n', 'N').one.types).toEqual([]);
  });

  it('reads answer values from the syntax tree alone, never strings or comments', () => {
    const text = [
      'const spelled = "{ answer: arms(\'ghost\') }";',
      "// operation('ghost', { answer: arms(1) })",
      '/* { answer: MySchema } */',
      '',
    ].join('\n');
    const read = usage(text, 'src/a.ts');
    expect(read.calls.some(({ callee }) => callee === 'operation' || callee === 'arms')).toBe(false);
    expect(read.tops.find(({ name }) => name === 'spelled')?.calls).toEqual([]);
  });

  it('marks literal ids and spread second args so dynamic ids stay unjudged', () => {
    const literal = usage("export const a = operation('x', { answer: arms(1) });\n", 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(literal).toMatchObject({ first: 'x', firstLiteral: true });
    const template = usage('export const b = operation(`y`, { answer: 1 });\n', 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(template).toMatchObject({ first: 'y', firstLiteral: true });
    const ident = usage('export const c = operation(id, { answer: 1 });\n', 'src/a.ts').calls.find(({ callee }) => callee === 'operation');
    expect(ident?.first).toBe('id');
    expect(ident?.firstLiteral).toBeUndefined();
    const member = usage('export const d = pair(OPS.id, body(1));\n', 'src/a.ts').calls.find(({ callee }) => callee === 'pair');
    expect(member?.first).toBe('OPS.id');
    expect(member?.firstLiteral).toBeUndefined();
    const dynamic = usage('export const e = operation(`a${b}`, { answer: 1 });\n', 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(dynamic?.first).toBeUndefined();
    expect(dynamic?.firstLiteral).toBeUndefined();
    const spread = usage("export const f = operation('x', { ...WITH_ANSWER });\n", 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(spread?.secondSpread).toBe(true);
    expect(spread?.secondProperties).toEqual([]);
    const computed = usage("export const g = operation('x', { [key]: 1 });\n", 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(computed?.secondSpread).toBe(true);
    const plain = usage("export const h = operation('x', { answer: 1 });\n", 'src/a.ts').calls.find(({ callee }) => callee === 'operation');
    expect(plain?.secondSpread).toBeUndefined();
  });

  it('reads angle-bracket asserted answer objects and plain entry spreads', () => {
    const asserted = usage("export const op = operation('id', <Ans>{ answer: arms(1) });\n", 'src/a.ts').calls.find(
      ({ callee }) => callee === 'operation',
    );
    expect(asserted?.keys).toEqual(['answer']);
    expect(asserted?.secondProperties?.find(({ key }) => key === 'answer')?.value).toEqual({ form: 'call', callee: 'arms' });
    const table = top('export const X_OPERATIONS = { spread: { ...WITH_ANSWER }, whole: { answer: MySchema } };\n', 'X_OPERATIONS').one;
    expect(table.entries?.find(({ key }) => key === 'spread')?.spread).toBe(true);
    expect(table.entries?.find(({ key }) => key === 'whole')?.spread).toBeUndefined();
    expect(table.entries?.find(({ key }) => key === 'whole')?.properties?.find(({ key }) => key === 'answer')?.value).toEqual({
      form: 'identifier',
      name: 'MySchema',
    });
  });
});
