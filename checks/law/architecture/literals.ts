import { databaseAt } from '../declarations/database';
import { blobsAt } from '../declarations/index';
import type { VendorParams } from './inspections';
import type { Snapshot } from './snapshot';
import { isVendorSource, stringsOf } from './strings';

const ready = new Set<string>();
const database = (root: string) => {
  const db = databaseAt(root);
  if (!ready.has(root)) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS architecture_literals (version TEXT NOT NULL, blob TEXT NOT NULL, tokens TEXT NOT NULL, UNIQUE (version, blob))',
    );
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS architecture_literals_search USING fts5(tokens, content='architecture_literals', content_rowid='rowid', tokenize='unicode61')",
    );
    ready.add(root);
  }
  return db;
};

export const indexLiterals = (root: string, version: string, snapshot: Snapshot, params: VendorParams): void => {
  const db = database(root);
  const held = db.query('SELECT 1 FROM architecture_literals WHERE version = ? AND blob = ?');
  const insert = db.query('INSERT OR IGNORE INTO architecture_literals (version, blob, tokens) VALUES (?, ?, ?)');
  const search = db.query('INSERT INTO architecture_literals_search (rowid, tokens) VALUES (?, ?)');
  db.transaction(() => {
    for (const path of snapshot.paths) {
      if (!isVendorSource(path, params)) continue;
      const blob = snapshot.tree.object?.(path);
      if (blob === undefined) throw new Error(`${path}: a vendor literal source has no versioned blob`);
      if (held.get(version, blob) !== null) continue;
      const tokens = stringsOf(snapshot.file(path))
        .map((one) => one.text)
        .join('\n');
      const result = insert.run(version, blob, tokens);
      if (result.changes > 0) search.run(result.lastInsertRowid, tokens);
    }
  })();
};

export const literalCandidates = (root: string, version: string, revision: string, words: readonly string[]): readonly string[] => {
  if (words.length === 0) return [];
  const phrase = words.map((word) => `"${word.replaceAll('"', '""')}"`).join(' OR ');
  const rows = database(root)
    .query<{ path: string; blob: string }, [string, string]>(
      'SELECT p.path, l.blob FROM architecture_literals_search JOIN architecture_literals l ON l.rowid = architecture_literals_search.rowid JOIN places p ON p.blob = l.blob WHERE architecture_literals_search MATCH ? AND l.version = ?',
    )
    .all(phrase, version);
  const actual = blobsAt(root, revision, [...new Set(rows.map((one) => one.path))]);
  return [...new Set(rows.filter((one) => actual.get(one.path) === one.blob).map((one) => one.path))];
};
