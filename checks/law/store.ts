import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { blobTexts, entriesAt, type Entry, git } from './git';

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS facts (blob TEXT NOT NULL, class TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (blob, class)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS places (blob TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (blob, path)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS links (stem TEXT NOT NULL, blob TEXT NOT NULL, spec TEXT NOT NULL, PRIMARY KEY (stem, blob, spec)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS shapes (key TEXT NOT NULL, blob TEXT NOT NULL, PRIMARY KEY (key, blob)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS manifests (blob TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS indexed (tree TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS map_nodes (id TEXT PRIMARY KEY, body TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS map_roots (family TEXT NOT NULL, revision TEXT NOT NULL, root TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (family, revision)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS catalogue.nodes (tree TEXT PRIMARY KEY, entries TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS catalogue.roots (revision TEXT PRIMARY KEY, tree TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID',
] as const;

type Reader = { readonly root: string; readonly revision: string };

const readers = new AsyncLocalStorage<Reader>();
const versions = new Map<string, string>();

export const withReader = <A>(root: string, revision: string, use: () => A): A => readers.run({ root, revision }, use);

const version = (root: string): string => {
  const reader = readers.getStore();
  const revision = reader?.root === root ? reader.revision : undefined;
  const key = `${root}\0${revision ?? ''}`;
  const held = versions.get(key);
  if (held !== undefined) return held;
  const sources = [
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
    'architecture/boundaries.ts',
    'architecture/snapshot.ts',
  ].map((name) => {
    const file = join(import.meta.dir, name);
    return { file, path: relative(root, file).split(sep).join('/') };
  });
  const paths = sources.map((one) => one.path).filter((path) => !isAbsolute(path) && path !== '..' && !path.startsWith('../'));
  const tracked = revision === undefined || paths.length === 0 ? new Map<string, Entry>() : entriesAt(root, revision, paths, false);
  const texts = blobTexts(
    root,
    [...tracked.values()].filter((one) => one.kind === 'blob').map((one) => one.object),
  );
  const hash = createHash('sha256').update(readFileSync(Bun.resolveSync('typescript/package.json', import.meta.dir)));
  for (const source of sources) {
    const entry = tracked.get(source.path);
    hash.update(entry?.kind === 'blob' ? texts.get(entry.object)! : readFileSync(source.file));
  }
  const found = hash.digest('hex');
  versions.set(key, found);
  return found;
};

export const sameReader = (root: string, from: string, to: string): boolean =>
  withReader(root, from, () => version(root)) === withReader(root, to, () => version(root));

const handles = new Map<string, Database>();

export const databaseAt = (root: string): Database => {
  const reader = version(root);
  const key = `${root}\0${reader}`;
  const held = handles.get(key);
  if (held !== undefined) return held;
  const directory = join(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString().trim(), 'runlith-law');
  mkdirSync(directory, { recursive: true });
  const database = new Database(join(directory, `declarations-${reader}.sqlite`));
  database.exec('PRAGMA busy_timeout = 20000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.query('ATTACH DATABASE ? AS catalogue').run(join(directory, 'declarations.sqlite'));
  database.exec('PRAGMA catalogue.journal_mode = WAL');
  database.exec('PRAGMA catalogue.synchronous = NORMAL');
  database.exec('BEGIN IMMEDIATE');
  for (const statement of SCHEMA) database.exec(statement);
  database.exec('COMMIT');
  handles.set(key, database);
  return database;
};
