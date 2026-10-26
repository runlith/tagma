import { Database } from 'bun:sqlite';
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const COPIES = 3;

const stamp = (file: string): string => {
  const main = statSync(file);
  const wal = statSync(`${file}-wal`, { throwIfNoEntry: false });
  return `${main.size} ${main.mtimeMs} ${wal?.size ?? -1} ${wal?.mtimeMs ?? -1}`;
};

const copied = (file: string, copy: string): void => {
  for (let attempt = 1; ; attempt += 1) {
    const before = stamp(file);
    copyFileSync(file, copy);
    const wal = statSync(`${file}-wal`, { throwIfNoEntry: false });
    if (wal === undefined) rmSync(`${copy}-wal`, { force: true });
    else copyFileSync(`${file}-wal`, `${copy}-wal`);
    if (stamp(file) === before) return;
    if (attempt === COPIES) throw new Error(`the browser kept writing ${basename(file)} while it was copied`);
  }
};

export const snapshotted = <A>(file: string, read: (db: Database) => A): A => {
  const folder = mkdtempSync(join(tmpdir(), 'browser-cookies-'));
  try {
    const copy = join(folder, basename(file));
    copied(file, copy);
    const db = new Database(copy);
    try {
      return read(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

export const columnsOf = (db: Database, table: string): ReadonlySet<string> =>
  new Set(
    db
      .query<{ readonly name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((column) => column.name),
  );

export const flag = (raw: unknown): boolean | null => (raw === 0 || raw === 0n ? false : raw === 1 || raw === 1n ? true : null);
