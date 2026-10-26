import { Database } from 'bun:sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { baselineObjects, schemaDigest, type SchemaObject } from '../src/platform/store/baseline.js';
import { RETIRED_TABLES } from '../src/composition/manifest.js';

const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const literal = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  throw new Error(`A seed value has no SQLite literal: ${String(value)}`);
};
const objectsOf = (db: Database): SchemaObject[] => db.query<SchemaObject, []>(baselineObjects).all();
const rowsOf = (db: Database, name: string): Record<string, unknown>[] =>
  db.query<Record<string, unknown>, []>(`select * from ${quote(name)}`).all();

export async function generateBaseline(source: string, output: string, evidence: string, release: string, cut?: string): Promise<void> {
  if (resolve(source) === resolve(output))
    throw new Error('Source and output must differ; the source chain stays intact until equality is proved.');
  const shipped = readMigrationFiles({ migrationsFolder: source });
  if (cut !== undefined && !shipped.some(({ name }) => name === cut)) throw new Error(`The source chain has no cut ${cut}.`);
  const migrations = shipped.filter(({ name }) => cut === undefined || name <= cut);
  const tail = shipped.slice(migrations.length);
  const head = migrations.at(-1);
  if (head === undefined) throw new Error('An empty chain has no baseline.');
  if (tail[0]?.folderMillis === head.folderMillis)
    throw new Error(`The cut ${head.name} splits a migration-time group with ${tail[0].name}.`);
  const name = `${head.name.slice(0, 14)}_baseline`;
  const db = new Database(':memory:');
  const folded = new Database(':memory:');
  try {
    for (const migration of migrations) {
      db.exec('PRAGMA foreign_keys = OFF');
      try {
        for (const statement of migration.sql) db.exec(statement);
      } catch (cause) {
        throw new Error(`The source chain failed at ${migration.name}`, { cause });
      }
    }
    const objects = objectsOf(db);
    const tables = objects.filter((object) => object.type === 'table');
    const seeds = tables.flatMap(({ name }) => {
      const rows = rowsOf(db, name);
      if (rows.length === 0) return [];
      const columns = db
        .query<{ name: string }, []>(`select name from pragma_table_xinfo(${literal(name)}) where hidden = 0 order by cid`)
        .all();
      const sql = rows.map(
        (row) =>
          `INSERT INTO ${quote(name)} (${columns.map(({ name }) => quote(name)).join(', ')}) VALUES (${columns.map(({ name: column }) => (name === 'spent_epoch' && column === 'at' ? "strftime('%s', 'now') * 1000" : literal(row[column]))).join(', ')});`,
      );
      return [{ name, rows, sql }];
    });
    const statements = [
      ...tables.map((object) => `${object.sql};`),
      ...seeds.flatMap((seed) => seed.sql),
      ...objects.filter((object) => object.type !== 'table').map((object) => `${object.sql};`),
    ];
    const seededAt = Date.now();
    for (const statement of statements) folded.exec(statement);
    const objectsAfter = objectsOf(folded);
    if (JSON.stringify(objectsAfter) !== JSON.stringify(objects)) {
      const changed = objects.filter((before) => !objectsAfter.some((after) => JSON.stringify(after) === JSON.stringify(before)));
      throw new Error(`Baseline schema differs: ${changed.map(({ type, name }) => `${type}:${name}`).join(', ')}`);
    }
    for (const seed of seeds) {
      if (seed.name === 'spent_epoch') {
        const at = rowsOf(folded, seed.name)[0]?.at;
        if (typeof at !== 'number' || at < Math.floor(seededAt / 1000) * 1000 || at > Date.now())
          throw new Error('The baseline spent-key epoch does not begin when its store is created.');
        db.query('update spent_epoch set at = ?').run(at);
        seed.rows = rowsOf(db, seed.name);
      }
      if (JSON.stringify(rowsOf(folded, seed.name)) !== JSON.stringify(seed.rows))
        throw new Error(`Baseline seed rows differ in ${seed.name}`);
    }
    const snapshots = (await readdir(source))
      .filter((entry) => migrations.some(({ name }) => name === entry))
      .sort()
      .reverse();
    let snapshot: Record<string, unknown> | undefined;
    for (const candidate of snapshots) {
      try {
        snapshot = JSON.parse(await readFile(join(source, candidate, 'snapshot.json'), 'utf8')) as Record<string, unknown>;
        break;
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
      }
    }
    if (snapshot === undefined) throw new Error('The source chain has no drizzle-kit snapshot.');
    snapshot.prevIds = [];
    await mkdir(join(output, name), { recursive: true });
    await mkdir(evidence, { recursive: true });
    await writeFile(join(output, name, 'migration.sql'), `${statements.join('\n--> statement-breakpoint\n')}\n`);
    await writeFile(join(output, name, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    await writeFile(join(evidence, 'schema.json'), `${JSON.stringify(objects, null, 2)}\n`);
    await writeFile(
      join(evidence, 'seeds.json'),
      `${JSON.stringify(
        seeds.map(({ name, rows }) => ({ name, rows })),
        null,
        2,
      )}\n`,
    );
    db.exec(
      `CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at text)`,
    );
    const recorded = db.query('insert into __drizzle_migrations (hash, created_at, name, applied_at) values (?, ?, ?, ?)');
    for (const migration of migrations) recorded.run(migration.hash, migration.folderMillis, migration.name, '2026-10-10T00:00:00.000Z');
    db.exec(`VACUUM INTO ${literal(join(evidence, 'chain.sqlite'))}`);
    const tailReceipt: { name: string; hash: string; folderMillis: number; schema: string }[] = [];
    for (const migration of tail) {
      db.exec('PRAGMA foreign_keys = OFF');
      folded.exec('PRAGMA foreign_keys = OFF');
      for (const statement of migration.sql) {
        db.exec(statement);
        folded.exec(statement);
      }
      if (JSON.stringify(objectsOf(db)) !== JSON.stringify(objectsOf(folded)))
        throw new Error(`Baseline and source schemas differ after ${migration.name}`);
      for (const { name: table } of objectsOf(db).filter(({ type }) => type === 'table'))
        if (JSON.stringify(rowsOf(db, table)) !== JSON.stringify(rowsOf(folded, table)))
          throw new Error(`Baseline and source rows differ in ${table} after ${migration.name}`);
      for (const table of RETIRED_TABLES) {
        const standing = objectsOf(db).some(({ type, name }) => type === 'table' && name === table);
        if (!standing) continue;
        const before = schemaDigest(objectsOf(folded), RETIRED_TABLES);
        folded.exec(`SAVEPOINT disposal; DROP TABLE ${quote(table)}`);
        if (schemaDigest(objectsOf(folded), RETIRED_TABLES) !== before)
          throw new Error(`Removing the retired table ${table} changes live schema objects after ${migration.name}`);
        folded.exec('ROLLBACK TO disposal; RELEASE disposal');
      }
      tailReceipt.push({
        name: migration.name,
        hash: migration.hash,
        folderMillis: migration.folderMillis,
        schema: schemaDigest(objectsOf(db), RETIRED_TABLES),
      });
      await mkdir(join(output, migration.name), { recursive: true });
      for (const file of await readdir(join(source, migration.name)))
        await writeFile(join(output, migration.name, file), await readFile(join(source, migration.name, file)));
    }
    await writeFile(
      join(output, 'baseline.json'),
      `${JSON.stringify(
        {
          migration: name,
          release,
          schema: schemaDigest(objects, RETIRED_TABLES),
          retiredTables: RETIRED_TABLES,
          chain: migrations.map(({ name, hash, folderMillis }) => ({ name, hash, folderMillis })),
          tail: tailReceipt,
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      JSON.stringify({
        source,
        output,
        name,
        migrations: migrations.length,
        tail: tail.length,
        objects: objects.length,
        seeds: seeds.map(({ name, rows }) => ({ name, rows: rows.length })),
        schema: schemaDigest(objects, RETIRED_TABLES),
      }),
    );
  } finally {
    db.close();
    folded.close();
  }
}

if (import.meta.main && process.argv[2] === 'install') {
  const [, source, target] = process.argv.slice(2);
  if (source === undefined || target === undefined || resolve(source) === resolve(target))
    throw new Error('Usage: bun scripts/baseline.ts install <generated chain> <target chain>');
  const receipt = JSON.parse(await readFile(join(source, 'baseline.json'), 'utf8')) as {
    migration: string;
    chain: { name: string }[];
    tail: { name: string }[];
  };
  await mkdir(target, { recursive: true });
  for (const { name } of receipt.chain) await rm(join(target, name), { recursive: true, force: true });
  for (const name of await readdir(target))
    if (name.endsWith('_baseline') && name !== receipt.migration) await rm(join(target, name), { recursive: true });
  for (const name of [receipt.migration, ...receipt.tail.map(({ name }) => name)])
    await cp(join(source, name), join(target, name), { recursive: true });
  await cp(join(source, 'baseline.json'), join(target, 'baseline.json'));
} else if (import.meta.main) {
  const [source, output, evidence, release, cut] = process.argv.slice(2);
  if (source === undefined || output === undefined || evidence === undefined || release === undefined)
    throw new Error(
      'Usage: bun scripts/baseline.ts <source chain> <output chain> <evidence directory> <release that carries the folded chain> [cut migration]',
    );
  await generateBaseline(resolve(source), resolve(output), resolve(evidence), release, cut);
}
