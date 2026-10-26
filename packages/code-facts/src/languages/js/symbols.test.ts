import { expect, it } from 'bun:test';
import { js } from '../adapters';

it('binds local shadows and type/value meanings without loading other source files', async () => {
  const reader = await js.symbols!();
  const source = [
    'export type Peer = { ok: true };',
    'export const Peer = 1;',
    'export function use(Peer: number) {',
    '  const shape: Peer = { ok: true };',
    '  return Peer;',
    '}',
    'export const queried: typeof Peer = Peer;',
    'export type Missing = Absent;',
    'import type { Foreign as Renamed } from "./foreign.js";',
    'import * as NS from "./foreign.js";',
    'export type Alias = Renamed;',
    'export type Member = NS.Foreign;',
    'export { Peer as Published };',
    'export * from "./forwarded.js";',
    'export const wrapped = { Peer };',
  ].join('\n');
  const read = reader.read(source, 'src/a.ts');
  const typeUse = read.references.find((one) => one.line === 4 && one.name === 'Peer');
  const valueUse = read.references.find((one) => one.line === 5 && one.name === 'Peer');
  expect(typeUse?.definitions).toMatchObject([{ line: 1, spaces: ['type'] }]);
  expect(valueUse?.definitions).toMatchObject([{ line: 3, spaces: ['value'] }]);
  expect(read.references.find((one) => one.line === 7 && one.name === 'Peer')?.definitions).toMatchObject([{ line: 2, spaces: ['value'] }]);
  expect(read.references.find((one) => one.name === 'Absent')?.definitions).toEqual([]);
  expect(read.references.find((one) => one.line === 11 && one.name === 'Renamed')?.imported).toEqual({
    from: './foreign.js',
    name: 'Foreign',
    meaning: 'type',
  });
  expect(read.references.find((one) => one.line === 12 && one.name === 'NS')?.imported).toEqual({
    from: './foreign.js',
    name: 'Foreign',
    meaning: 'type',
  });
  expect(read.exports.find((one) => one.name === 'Published')).toMatchObject({ line: 13, definitions: [{ line: 1 }, { line: 2 }] });
  expect(read.forwards).toEqual([{ from: './forwarded.js', line: 14 }]);
  expect(read.references.find((one) => one.line === 15 && one.name === 'Peer')?.definitions).toMatchObject([
    { line: 2, spaces: ['value'] },
  ]);
  const embedded = reader.read(
    '<script module lang="ts">\nexport type Peer = string;\nexport type Use = Peer;\n</script>',
    'Component.svelte',
  );
  expect(embedded.references.find((one) => one.line === 3 && one.name === 'Peer')?.definitions).toMatchObject([
    { line: 2, spaces: ['type'] },
  ]);
  const jsx = reader.read('const Peer = () => null; export const view = <Peer />;', 'view.js');
  expect(jsx.references.find((one) => one.name === 'Peer')?.definitions).toMatchObject([{ line: 1, spaces: ['value'] }]);
});
