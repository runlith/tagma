import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { git } from './git';

const INDEX = ['facts', 'places', 'links', 'shapes', 'manifests', 'indexed', 'map_roots'] as const;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS facts (blob TEXT NOT NULL, class TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (blob, class)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS places (blob TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (blob, path)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS links (stem TEXT NOT NULL, blob TEXT NOT NULL, spec TEXT NOT NULL, PRIMARY KEY (stem, blob, spec)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS shapes (key TEXT NOT NULL, blob TEXT NOT NULL, PRIMARY KEY (key, blob)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS manifests (blob TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS indexed (tree TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID',
  'DROP TABLE IF EXISTS results',
  'DROP TABLE IF EXISTS memo',
  'CREATE TABLE IF NOT EXISTS map_nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS map_roots (family TEXT NOT NULL, revision TEXT NOT NULL, root TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (family, revision)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, version TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS nodes (tree TEXT PRIMARY KEY, entries TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS roots (revision TEXT PRIMARY KEY, tree TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID',
] as const;

const version = (): string => {
  const hash = createHash('sha256').update(readFileSync(Bun.resolveSync('typescript/package.json', import.meta.dir)));
  for (const name of [
    'declarations/facts.ts',
    'declarations/read.ts',
    'declarations/compact.ts',
    'declarations/index.ts',
    'store.ts',
    'directories.ts',
    'maps.ts',
    'git.ts',
    'declarations/gate.ts',
    'declarations/dead.ts',
    'declarations/repeated.ts',
    'declarations/resolve.ts',
    'declarations/corpus.ts',
    'declarations/glob.ts',
  ])
    hash.update(readFileSync(join(import.meta.dir, name)));
  return hash.digest('hex');
};

const handles = new Map<string, Database>();

export const databaseAt = (root: string): Database => {
  const held = handles.get(root);
  if (held !== undefined) return held;
  const directory = join(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim(), 'runlith-law');
  mkdirSync(directory, { recursive: true });
  const database = new Database(join(directory, 'declarations.sqlite'));
  database.exec('PRAGMA busy_timeout = 20000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('BEGIN IMMEDIATE');
  for (const statement of SCHEMA) database.exec(statement);
  const wanted = version();
  const stored = database.query<{ version: string }, []>("SELECT version FROM meta WHERE name = 'index'").get();
  if (stored?.version !== wanted) {
    for (const table of INDEX) database.exec(`DELETE FROM ${table}`);
    database.query("INSERT OR REPLACE INTO meta (name, version) VALUES ('index', ?)").run(wanted);
  }
  database.exec('COMMIT');
  handles.set(root, database);
  return database;
};
