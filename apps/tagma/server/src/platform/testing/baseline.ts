import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { BaselineReceipt } from '../store/baseline.js';
import type { MigrationChain } from '../contract/service/store.js';

export const sourceStore = (path: string, migrations: MigrationChain<'machine'>, appliedTail = 0): void => {
  const receipt = JSON.parse(readFileSync(join(migrations.folder, 'baseline.json'), 'utf8')) as BaselineReceipt;
  const local = readMigrationFiles({ migrationsFolder: migrations.folder });
  const db = new Database(path);
  try {
    db.transaction(() => {
      for (const migration of local.slice(0, 1 + appliedTail)) for (const statement of migration.sql) db.exec(statement);
      db.exec(
        'create table __drizzle_migrations (id integer primary key autoincrement, hash text not null, created_at numeric, name text, applied_at text)',
      );
      const record = db.query('insert into __drizzle_migrations (hash, created_at, name, applied_at) values (?, ?, ?, ?)');
      for (const row of [...receipt.chain, ...receipt.tail.slice(0, appliedTail)]) {
        record.run(row.hash, row.folderMillis, row.name, new Date(row.folderMillis).toISOString());
      }
    })();
  } finally {
    db.close();
  }
};
