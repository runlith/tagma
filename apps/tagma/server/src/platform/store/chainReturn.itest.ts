import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { returnToChain } from '@runlith/sqlite-process/chainReturn';

const CHAIN_LEDGER = '__drizzle_migrations';

const roots = new URL('../../../../../../', import.meta.url).pathname;
const server = join(roots, 'apps/tagma/server');
const CHAINS = [
  ['machine', join(server, 'drizzle')],
  ['activity', join(roots, 'packages/activity/drizzle')],
  ['performance', join(roots, 'packages/performance/drizzle')],
  ['host', join(roots, 'packages/execution-host/drizzle')],
] as const;

const LEDGER = `CREATE TABLE ${CHAIN_LEDGER} (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`;

type Step = ReturnType<typeof readMigrationFiles>[number];

const ran = (db: Database, one: Step): void => {
  for (const statement of one.sql) if (statement.trim() !== '') db.run(statement);
  db.run(`INSERT INTO ${CHAIN_LEDGER} (hash, created_at, name, applied_at) VALUES (?, ?, ?, 'then')`, [
    one.hash,
    one.folderMillis,
    one.name ?? null,
  ]);
};

const shapeOf = (db: Database) =>
  db
    .query<{ type: string; name: string; sql: string }, []>(
      `select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name != '${CHAIN_LEDGER}' order by type, name`,
    )
    .all();

const ledgerOf = (db: Database) =>
  db
    .query<{ name: string }, []>(`select name from ${CHAIN_LEDGER} order by created_at, id`)
    .all()
    .map((row) => row.name);

const NEWEST = 3;

test('the newest migrations of every shipped chain step back to the build before them and forward again, schema and ledger exact', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'chain-return-shipped-')));
  try {
    for (const [name, folder] of CHAINS) {
      const steps = readMigrationFiles({ migrationsFolder: folder });
      const before = new Database(':memory:');
      before.run('PRAGMA foreign_keys = OFF');
      before.run(LEDGER);
      for (const [at, step] of steps.entries()) {
        if (at === 0 || at < steps.length - NEWEST) {
          ran(before, step);
          continue;
        }
        const earlier = shapeOf(before);
        const path = join(home, `${name}-${at}.sqlite`);
        before.run(`VACUUM INTO '${path}'`);
        ran(before, step);
        const later = shapeOf(before);
        const store = new Database(path);
        store.run('PRAGMA foreign_keys = OFF');
        ran(store, step);
        store.close();
        const target = { steps: steps.slice(0, at) };
        const leaving = { steps: steps.slice(0, at + 1), folder };
        const answer = returnToChain(path, target, leaving);
        const returned = new Database(path);
        returned.run('PRAGMA foreign_keys = OFF');
        expect([step.name, answer.returned, ledgerOf(returned)]).toEqual([step.name, true, target.steps.map((one) => one.name)]);
        expect([step.name, shapeOf(returned)]).toEqual([step.name, earlier]);
        ran(returned, step);
        expect([step.name, shapeOf(returned)]).toEqual([step.name, later]);
        returned.close();
      }
      before.close();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
