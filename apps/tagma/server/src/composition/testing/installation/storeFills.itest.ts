import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { returnToChain } from '@runlith/sqlite-process/chainReturn';
import { dataStores, fillsOf } from '../../dataStores.js';
import { DEVELOPER } from '../../developer/build.js';

const CHAIN = join(import.meta.dir, '../../../../drizzle');
const LEDGER =
  'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)';
const RESHAPED = {
  name: '29991231000000_reshaped_message_index',
  hash: 'reshaped-message-index',
  folderMillis: Date.UTC(2999, 11, 31),
  sql: [
    'DROP TABLE `thread_message_fts`',
    "CREATE VIRTUAL TABLE `thread_message_fts` USING fts5(`text`, `said` UNINDEXED, content = '', contentless_delete = 1, tokenize = 'trigram')",
  ],
};

type Step = { readonly name?: string; readonly hash: string; readonly folderMillis: number; readonly sql: readonly string[] };

const ran = (db: Database, step: Step): void => {
  for (const statement of step.sql) if (statement.trim() !== '') db.run(statement);
  db.run('INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)', [step.hash, step.folderMillis, step.name ?? null]);
};

test('a step back that recreates the message index fills it again from the messages, so what was said stays findable', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'store-fills-')));
  try {
    const steps = readMigrationFiles({ migrationsFolder: CHAIN });
    const path = join(home, 'tagma.sqlite');
    const db = new Database(path);
    db.run('PRAGMA foreign_keys = OFF');
    db.run(LEDGER);
    for (const step of [...steps, RESHAPED]) ran(db, step);
    db.run('PRAGMA foreign_keys = OFF');
    db.run(
      "INSERT INTO thread_message (key, thread_id, entry_id, position, appeared, role, occurred_at, text) VALUES (7, 't', 'm', 1, 1, 'user', 0, 'We go to Montenegro next week')",
    );
    db.close();

    const machine = dataStores(path, [], fillsOf((await DEVELOPER.parts()).modules)).find((store) => store.path === path);
    const answer = returnToChain(path, { steps }, { steps: [...steps, RESHAPED], folder: null }, machine?.fills);
    const returned = new Database(path, { readonly: true });
    const found = returned.query('select rowid from thread_message_fts where thread_message_fts match ?').all('"montenegro"');
    returned.close();

    expect([answer.returned, answer.unfilled, found]).toEqual([true, [], [{ rowid: 7 }]]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
