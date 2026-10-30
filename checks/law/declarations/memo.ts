import { databaseAt } from '../store';

const KEPT = 1024;

export const revisionAt = (root: string, key: string): unknown => {
  const row = databaseAt(root).query<{ value: string }, [string]>('SELECT value FROM memo WHERE key = ?').get(key);
  return row === null ? undefined : (JSON.parse(row.value) as unknown);
};

export const saveRevision = (root: string, key: string, value: unknown): void => {
  const database = databaseAt(root);
  database.transaction(() => {
    database.query('INSERT OR REPLACE INTO memo (key, value, at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), Date.now());
    database.query('DELETE FROM memo WHERE key IN (SELECT key FROM memo ORDER BY at DESC LIMIT -1 OFFSET ?)').run(KEPT);
  })();
};
