import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRetainers } from './loadRetainers.js';

test('retainers follow strong dominators with shared ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'retainers-'));
  try {
    const fields = ['type', 'name', 'self_size', 'edge_count'];
    const nodes = [
      [0, 0, 0, 3],
      [1, 1, 1, 2],
      [1, 2, 2, 1],
      [1, 3, 3, 2],
      [1, 4, 4, 1],
      [1, 5, 5, 0],
      [2, 6, 6, 0],
      [3, 7, 7, 0],
      [4, 8, 1, 1],
      [5, 9, 2, 1],
      [3, 10, 1000, 0],
    ];
    const edges = [
      [0, 1],
      [0, 2],
      [0, 8],
      [0, 3],
      [0, 4],
      [0, 3],
      [0, 6],
      [0, 7],
      [1, 5],
      [0, 9],
      [0, 10],
    ].flatMap(([type, target]) => [type, 0, target! * fields.length]);
    const snapshot = {
      snapshot: {
        meta: {
          node_fields: fields,
          node_types: [['synthetic', 'object', 'native', 'string', 'closure', 'array'], 'string', 'number', 'number'],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [['property', 'weak'], 'string_or_number', 'node'],
        },
      },
      nodes: nodes.flat(),
      edges,
      strings: ['root', 'A', 'B', 'C', 'D', 'E', 'F', 'secret application text', 'secret closure', 'secret array', 'secret large text'],
    };
    const file = join(dir, 'sample.heapsnapshot');
    await writeFile(file, JSON.stringify(snapshot));
    const result = await loadRetainers(file, 10);
    expect(result.nonAdditive).toBe(true);
    expect(result.reachable).toBe(10);
    expect(result.rows.map(({ name, retainedBytes }) => [name, retainedBytes])).toEqual([
      ['[closure]', 1003],
      ['[array]', 1002],
      ['[string]', 1000],
      ['C', 16],
      ['[string]', 7],
      ['F', 6],
      ['A', 5],
      ['D', 4],
      ['B', 2],
    ]);
    expect(result.rows.find((row) => row.type === 'array')?.dominators.map((node) => node.name)).toEqual(['[closure]', '[synthetic]']);
    expect(result.rows.find((row) => row.name === 'C')?.dominators.map((node) => node.type)).toEqual(['synthetic']);
    expect(result.rows.find((row) => row.name === 'F')?.dominators.map((node) => node.name)).toEqual(['C', '[synthetic]']);
    expect(JSON.stringify(result)).not.toContain('secret');
    const already = new AbortController();
    already.abort();
    await expect(loadRetainers(file, 10, already.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const pending = new AbortController();
    const reading = loadRetainers(file, 10, pending.signal);
    pending.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
