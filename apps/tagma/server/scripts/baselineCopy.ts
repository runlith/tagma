import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { baselineObjects, schemaDigest, type SchemaObject } from '../src/platform/store/baseline.js';

const [machine, mirrors, target] = process.argv.slice(2);
if (!machine || !mirrors || !target)
  throw new Error('Usage: bun scripts/baselineCopy.ts <live machine> <live mirror root> <new proof root>');
const root = resolve(target);
await mkdir(root, { recursive: true });
const readOnly = (path: string, query: string) => {
  const result = spawnSync('sqlite3', ['-readonly', '-json', path, query], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path}: ${result.stderr}`);
  return result.stdout.trim() === '' ? [] : (JSON.parse(result.stdout) as Record<string, unknown>[]);
};
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const scalar = (value: unknown): string => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  throw new Error(`A SQLite scalar was not encoded: ${String(value)}`);
};
const insert = (db: Database, table: string, rows: readonly Record<string, unknown>[]) => {
  for (const row of rows)
    db.exec(`insert into ${quote(table)} (${Object.keys(row).map(quote).join(',')}) values (${Object.values(row).map(scalar).join(',')})`);
};
const witnessOf = (path: string) => {
  const objects = readOnly(path, baselineObjects) as SchemaObject[];
  const ledger = readOnly(path, "select name from sqlite_master where name = '__drizzle_migrations'");
  const rows = ledger.length === 0 ? [] : readOnly(path, 'select * from __drizzle_migrations order by created_at, id');
  return { path, bytes: 0, schema: schemaDigest(objects), objects: objects.length, rows, latest: rows.at(-1)?.name ?? null };
};
const objects = readOnly(machine, baselineObjects) as SchemaObject[];
const ledgerSql = readOnly(machine, "select sql from sqlite_master where name = '__drizzle_migrations'")[0]?.sql;
if (typeof ledgerSql !== 'string') throw new Error('The machine has no migration ledger.');
const before = witnessOf(machine);
const seeds = Object.fromEntries(
  ['meta', 'terminal_request_key_tally', 'd4_report', 'spent_epoch'].map((table) => [
    table,
    readOnly(machine, `select * from ${quote(table)}`),
  ]),
);
const after = witnessOf(machine);
if (JSON.stringify(before.rows) !== JSON.stringify(after.rows) || before.schema !== after.schema)
  throw new Error('The live schema or ledger moved during its bounded reading.');
const path = join(root, 'tagma.sqlite');
const db = new Database(path);
try {
  for (const object of objects.filter(({ type }) => type === 'table')) db.exec(`${object.sql};`);
  db.exec(ledgerSql);
  insert(db, '__drizzle_migrations', before.rows);
  for (const [name, rows] of Object.entries(seeds)) insert(db, name, rows);
  for (const object of objects.filter(({ type }) => type !== 'table')) db.exec(`${object.sql};`);
} finally {
  db.close();
}
const copies: ReturnType<typeof witnessOf>[] = [];
for (const project of await readdir(mirrors, { withFileTypes: true })) {
  if (!project.isDirectory()) continue;
  const directory = join(mirrors, project.name);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sqlite')) continue;
    const original = join(directory, entry.name);
    const witness = witnessOf(original);
    witness.bytes = (await stat(original)).size;
    copies.push(witness);
    const destination = join(root, 'mirror', project.name, entry.name);
    await mkdir(dirname(destination), { recursive: true });
    const backup = spawnSync('sqlite3', ['-readonly', original, `.backup '${destination.replaceAll("'", "''")}'`], { encoding: 'utf8' });
    if (backup.status !== 0) throw new Error(`${original}: mirror backup failed: ${backup.stderr}`);
    for (const suffix of ['.snapshot.json', '.snapshots']) {
      try {
        await cp(`${original}${suffix}`, `${destination}${suffix}`, { recursive: true });
      } catch (cause) {
        if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
      }
    }
  }
}
const unmarked = readOnly(
  machine,
  `select t.id, t.project_id from thread t left join thread_rollout_form f on f.thread_id = t.id
  where t.project_id is not null and (f.thread_id is null or f.publishing is not null)`,
);
const rolloutCopies: { id: string; project: number; path: string; bytes: number }[] = [];
for (const row of unmarked) {
  const id = String(row.id);
  const project = Number(row.project_id);
  const file = join(dirname(machine), 'threads', String(project), `${id}.jsonl`);
  for (const suffix of ['', '.zst']) {
    try {
      const info = await stat(`${file}${suffix}`);
      if (!info.isFile()) continue;
      const destination = join(root, 'unmarked-rollouts', String(project), `${id}.jsonl${suffix}`);
      await mkdir(dirname(destination), { recursive: true });
      await cp(`${file}${suffix}`, destination);
      rolloutCopies.push({ id, project, path: destination, bytes: info.size });
      break;
    } catch (cause) {
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause;
    }
  }
}
await writeFile(
  join(root, 'live-witness.json'),
  `${JSON.stringify({ machine: before, seeds, mirrors: copies, unmarked: rolloutCopies }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    machine: { latest: before.latest, applied: before.rows.length, schema: before.schema },
    mirrors: copies.map(({ path, latest, rows, bytes, schema }) => ({ path, latest, applied: rows.length, bytes, schema })),
    unmarked: {
      files: rolloutCopies.length,
      bytes: rolloutCopies.reduce((sum, { bytes }) => sum + bytes, 0),
      largest: rolloutCopies.toSorted((a, b) => b.bytes - a.bytes)[0] ?? null,
    },
    root,
  }),
);
