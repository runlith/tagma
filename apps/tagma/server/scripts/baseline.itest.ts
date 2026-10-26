import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateBaseline } from './baseline.js';

const cut = '20200101000000_source';
const following = '20200101000000_tail';

test('the generator refuses a cut inside a migration-time group and creates deterministic SQL with a store-creation epoch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'baseline-generation-'));
  const source = join(root, 'source');
  try {
    await mkdir(join(source, cut), { recursive: true });
    await mkdir(join(source, following));
    await writeFile(
      join(source, cut, 'migration.sql'),
      "CREATE TABLE spent_epoch (id integer primary key, at integer);\n--> statement-breakpoint\nINSERT INTO spent_epoch VALUES (1, strftime('%s', 'now') * 1000);",
    );
    await writeFile(join(source, following, 'migration.sql'), 'CREATE TABLE example (id integer primary key);');
    await writeFile(join(source, following, 'snapshot.json'), JSON.stringify({ prevIds: ['prior'] }));
    await expect(generateBaseline(source, join(root, 'rejected'), join(root, 'rejected-proof'), '0.1.0', cut)).rejects.toThrow(
      `The cut ${cut} splits a migration-time group with ${following}`,
    );
    await generateBaseline(source, join(root, 'a'), join(root, 'a-proof'), '0.1.0');
    await generateBaseline(source, join(root, 'b'), join(root, 'b-proof'), '0.1.0');
    const name = `${cut.slice(0, 14)}_baseline`;
    const text = await readFile(join(root, 'a', name, 'migration.sql'), 'utf8');
    expect(text).toBe(await readFile(join(root, 'b', name, 'migration.sql'), 'utf8'));
    const before = Math.floor(Date.now() / 1000) * 1000;
    const db = new Database(':memory:');
    try {
      db.exec(text);
      const row = db.query<{ at: number }, []>('select at from spent_epoch').get();
      expect(row?.at).toBeGreaterThanOrEqual(before);
      expect(row?.at).toBeLessThanOrEqual(Date.now());
      expect(db.query('select * from example').all()).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
