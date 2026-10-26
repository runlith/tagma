import { Database } from 'bun:sqlite';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_ID = '2026-03-13 10:38:09 737ae4a34738ffa0c3ff7f9bb18df914dd1cad163f28fd6b6e114a344fe6d618';
export const SOURCE_DIGEST = '32d5424f97e0a7fc5ed2f6335afbb58be4e0298bd7117a34e39d345ff13d859e';
export const LIBRARY_NAME = 'sqlite.native';
export const SOURCE_ARCHIVE = fileURLToPath(new URL('../native/sqlite.zip', import.meta.url));
const library = fileURLToPath(new URL('./sqlite.native', import.meta.url));
const here = dirname(fileURLToPath(import.meta.url));
const VERIFIED = join(here, '..', 'native', 'build', `${process.platform}-${process.arch}`, 'verified');
const SOURCES = [SOURCE_ARCHIVE, join(here, 'artifact.ts'), fileURLToPath(import.meta.url)];
const DENIED = new Set(['ENOENT', 'EACCES', 'EPERM', 'EROFS']);
let prepared: Promise<void> | undefined;
let selected = false;

const denied = (cause: unknown): boolean => cause instanceof Error && 'code' in cause && DENIED.has(String(cause.code));

const stamp = (paths: readonly string[]): string =>
  paths
    .map((path) => {
      const stat = statSync(path, { throwIfNoEntry: false });
      return stat === undefined ? '-' : `${stat.size}:${stat.mtimeMs}`;
    })
    .join(' ');

const verified = (): string | undefined => {
  try {
    return readFileSync(VERIFIED, 'utf8');
  } catch (cause) {
    if (denied(cause)) return undefined;
    throw cause;
  }
};

const recordVerified = (stamp: string): void => {
  try {
    writeFileSync(VERIFIED, stamp);
  } catch (cause) {
    if (!denied(cause)) throw cause;
  }
};

export const prepareEngine = (): Promise<void> =>
  (prepared ??= (async () => {
    if (await Bun.file(SOURCE_ARCHIVE).exists()) {
      const sources = stamp(SOURCES);
      if (verified() === `${sources} ${stamp([library])}`) return;
      await (await import('./artifact.js')).buildEngine();
      if (stamp(SOURCES) === sources) recordVerified(`${sources} ${stamp([library])}`);
    } else if (!(await Bun.file(library).exists())) {
      throw new Error('The supplied SQLite native asset is missing from this program.');
    }
  })());

export const selectEngine = (): void => {
  if (selected) return;
  try {
    if (!Database.setCustomSQLite(library)) {
      throw new Error('The supplied SQLite engine could not be selected before opening a database.');
    }
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.startsWith('SQLite already loaded')) throw cause;
    const database = new Database(':memory:');
    try {
      checkEngine(database);
    } finally {
      database.close();
    }
  }
  selected = true;
};

export const checkEngine = (database: Database): void => {
  const source = database.query<{ source: string }, []>('SELECT sqlite_source_id() AS source').get()?.source;
  if (source !== SOURCE_ID) throw new Error(`The supplied SQLite source is ${source}; expected ${SOURCE_ID}.`);
};
