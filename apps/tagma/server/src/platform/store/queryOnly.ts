import { Database } from 'bun:sqlite';
import { selectEngine } from '@runlith/sqlite-process/engine';

export const openQueryOnly = (path: string): Database => {
  selectEngine();
  const db = new Database(path, { readwrite: true, create: false });
  try {
    db.run('PRAGMA query_only = ON; PRAGMA busy_timeout = 250;');
    return db;
  } catch (cause) {
    db.close();
    throw cause;
  }
};
