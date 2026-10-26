import { Database } from 'bun:sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import config from '../drizzle.config';

const [folder, scratch] = process.argv.slice(2);
if (folder === undefined || scratch === undefined) throw new Error('Usage: bun scripts/baselineProbe.ts <generated chain> <scratch>');
const chain = resolve(folder);
const home = resolve(scratch);
await mkdir(home, { recursive: true });
const schema = join(home, 'schema.ts');
const configuration = join(home, 'drizzle.config.ts');
await writeFile(
  schema,
  `import { sqliteTable, text } from ${JSON.stringify(Bun.resolveSync('drizzle-orm/sqlite-core', process.cwd()))};\nexport const baselineProbe = sqliteTable('baseline_probe', { id: text('id').primaryKey() });\n`,
);
await writeFile(
  configuration,
  `import config from ${JSON.stringify(resolve('drizzle.config.ts'))};\nexport default { ...config, out: ${JSON.stringify(chain)}, schema: ${JSON.stringify([...(Array.isArray(config.schema) ? config.schema : [config.schema!]).map((file) => resolve(file)), schema])} };\n`,
);
const generated = spawnSync('bun', ['--bun', 'drizzle-kit', 'generate', '--config', configuration, '--name', 'baseline_probe'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 60_000,
});
console.log(generated.stdout);
if (generated.status !== 0) throw new Error(`drizzle-kit refused the baseline: ${generated.stderr}`);
const migrations = readMigrationFiles({ migrationsFolder: chain });
const probe = migrations.at(-1)!;
if (!probe.name.endsWith('_baseline_probe')) throw new Error('drizzle-kit did not create the requested next migration.');
const db = new Database(':memory:');
try {
  for (const migration of migrations) for (const statement of migration.sql) db.exec(statement);
  db.query("insert into baseline_probe (id) values ('accepted')").run();
  const row = db.query<{ id: string }, []>('select id from baseline_probe').get();
  if (row?.id !== 'accepted') throw new Error('The next migration did not create a usable table.');
  console.log(JSON.stringify({ accepted: true, next: probe.name, statements: probe.sql.length }));
} finally {
  db.close();
}
