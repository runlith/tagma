import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { derivedMap, entriesOf, rootAt, seededMap, valueAt } from './maps';
import { databaseAt } from './store';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'law-maps-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const keys = (count: number): [string, unknown][] => Array.from({ length: count }, (_, at) => [`key/${at}`, { at }]);

const nodeCount = (): number => databaseAt(root).query<{ count: number }, []>('SELECT count(*) AS count FROM map_nodes').get()!.count;

test('a map derived by changes is the map seeded from the same entries, and a change rewrites only the nodes above its key', () => {
  const full = keys(300);
  const seeded = seededMap(root, 'probe', 'full', full);
  const before = nodeCount();
  const changes = new Map<string, unknown>([['key/17', { at: 'new' }]]);
  const derived = derivedMap(root, 'probe', 'edit', seeded, changes);
  expect(nodeCount() - before).toBeLessThanOrEqual(6);
  const edited = full.map(([key, value]): [string, unknown] => [key, key === 'key/17' ? { at: 'new' } : value]);
  expect(derived).toBe(seededMap(root, 'probe', 'edited', edited));
  expect(entriesOf(root, derived)).toEqual([...edited].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  expect(valueAt(root, derived, 'key/17')).toEqual({ at: 'new' });
  expect(valueAt(root, derived, 'key/absent')).toBeUndefined();
  expect(rootAt(root, 'probe', 'edit')).toBe(derived);

  const removed = new Map<string, unknown>(full.slice(5).map(([key]) => [key, undefined]));
  const shrunk = derivedMap(root, 'probe', 'shrunk', seeded, removed);
  expect(shrunk).toBe(seededMap(root, 'probe', 'five', full.slice(0, 5)));
  const grown = derivedMap(root, 'probe', 'grown', shrunk, new Map(full.slice(5)));
  expect(grown).toBe(seeded);
});

test('a derived root over a node the store lost is refused and publishes nothing', () => {
  const seeded = seededMap(root, 'probe', 'full', keys(300));
  const database = databaseAt(root);
  const body = JSON.parse(database.query<{ body: string }, [string]>('SELECT body FROM map_nodes WHERE id = ?').get(seeded)!.body) as {
    c: [string, string, number][];
  };
  const digit = createHash('sha1').update('key/1').digest('hex')[0];
  const lost = body.c.find((one) => one[0] !== digit)!;
  database.query('DELETE FROM map_nodes WHERE id = ?').run(lost[1]);
  expect(() => derivedMap(root, 'probe', 'edit', seeded, new Map([['key/1', 'changed']]))).toThrow('keyed index');
  expect(rootAt(root, 'probe', 'edit')).toBeUndefined();
});
