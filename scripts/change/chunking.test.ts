import { expect, test } from 'bun:test';
import { costsOf, planChunks } from './chunking.ts';

const file = (name: string, wall: number) => ({ type: 'file', file: name, total: { cpu: wall, wall } });
const world = (name: string, kind: string, built: boolean, cpu: number, own: string | null = null) => ({
  type: 'world',
  file: name,
  kind,
  built,
  own,
  cost: { cpu: built ? cpu : 0, wall: built ? cpu : 0 },
});

test('report rows give each file its longest run, its world kinds and each kind its cost per build, own worlds left out', () => {
  const costs = costsOf([
    file('a.itest.ts', 600),
    file('a.itest.ts', 900),
    world('a.itest.ts', 'Door', true, 5000),
    world('a.itest.ts', 'Pool', true, 10),
    file('b.itest.ts', 300),
    world('b.itest.ts', 'Door', false, 0),
    world('b.itest.ts', 'Restart', true, 2000, 'restarts the server'),
    world('c.itest.ts', 'Door', true, 3000),
  ]);
  expect(costs.files.get('a.itest.ts')).toEqual({ wallMs: 900, worlds: ['Door', 'Pool'] });
  expect(costs.files.get('b.itest.ts')).toEqual({ wallMs: 300, worlds: ['Door'] });
  expect(costs.worlds.get('Door')).toEqual({ builds: 2, buildMs: 8000 });
  expect(costs.worlds.has('Restart')).toBe(false);
});

test('files of an expensive world share chunks, cheap files fill the room left, and unreported files keep the count split', () => {
  const rows = [
    ...['d1', 'd2', 'd3', 'd4'].flatMap((name, at) => [file(`${name}.itest.ts`, 1000), world(`${name}.itest.ts`, 'Door', at === 0, 5000)]),
    ...['t1', 't2'].flatMap((name, at) => [file(`${name}.itest.ts`, 1000), world(`${name}.itest.ts`, 'Terminal', at === 0, 4000)]),
    ...['l1', 'l2', 'l3'].flatMap((name) => [file(`${name}.itest.ts`, 500), world(`${name}.itest.ts`, 'Graph', true, 20)]),
  ];
  const chunks = planChunks({
    files: ['l1', 'd1', 't1', 'u1', 'd2', 'l2', 'd3', 'u2', 't2', 'd4', 'l3', 'u3'].map((name) => `${name}.itest.ts`),
    costs: costsOf(rows),
    lifeMs: 300_000,
    jobs: 3,
    filesPerFallbackChunk: 2,
  });
  expect(chunks.filter((chunk) => chunk.files.some((name) => name.startsWith('d')))).toEqual([expect.objectContaining({ world: 'Door' })]);
  const door = chunks.find((chunk) => chunk.world === 'Door')!;
  expect(door.files.filter((name) => name.startsWith('d'))).toEqual(['d1.itest.ts', 'd2.itest.ts', 'd3.itest.ts', 'd4.itest.ts']);
  expect(chunks.filter((chunk) => chunk.files.some((name) => name.startsWith('t')))).toEqual([
    expect.objectContaining({ world: 'Terminal' }),
  ]);
  expect(chunks.flatMap((chunk) => chunk.files.filter((name) => name.startsWith('l')))).toHaveLength(3);
  expect(chunks.filter((chunk) => chunk.world === null).map((chunk) => chunk.files)).toEqual([
    ['u1.itest.ts', 'u3.itest.ts'],
    ['u2.itest.ts'],
  ]);
});

test('a world whose files outlast one chunk splits into chunks that each fit the share of the life', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].flatMap((name, at) => [
    file(`${name}.itest.ts`, 100_000),
    world(`${name}.itest.ts`, 'Door', at === 0, 5000),
  ]);
  const chunks = planChunks({
    files: ['a', 'b', 'c', 'd', 'e'].map((name) => `${name}.itest.ts`),
    costs: costsOf(rows),
    lifeMs: 300_000,
    jobs: 2,
    filesPerFallbackChunk: 24,
  });
  expect(chunks.map((chunk) => chunk.files.length)).toEqual([2, 2, 1]);
  expect(chunks.every((chunk) => chunk.world === 'Door')).toBe(true);
});
