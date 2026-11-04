import { Database } from 'bun:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineFor } from './platform.js';

export const SOURCE_ID = '2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc';
export const SOURCE_DIGEST = '67f423e9ebbbdc473cbc4772c872ee6b89f31fde4ed0279a5c25d5f65c043a16';
export const LIBRARY_NAME = 'sqlite.native';
export const SOURCE_ARCHIVE = fileURLToPath(new URL('../native/sqlite.zip', import.meta.url));
const REQUIRED_OPTIONS = ['ENABLE_FTS5'];
const here = dirname(fileURLToPath(import.meta.url));
const engine = engineFor({
  library: fileURLToPath(new URL('./sqlite.native', import.meta.url)),
  archive: SOURCE_ARCHIVE,
  sources: [SOURCE_ARCHIVE, join(here, 'artifact.ts'), join(here, 'supply.ts'), fileURLToPath(import.meta.url)],
});
let prepared: Promise<void> | undefined;
let selected = false;

export const prepareEngine = (): Promise<void> => (prepared ??= engine.prepare());

export const selectEngine = (): void => {
  if (selected) return;
  engine.select();
  const database = new Database(':memory:');
  try {
    checkEngine(database);
    const options = new Set(
      database
        .query<{ compile_options: string }, []>('PRAGMA compile_options')
        .all()
        .map((row) => row.compile_options),
    );
    const missing = REQUIRED_OPTIONS.filter((option) => !options.has(option));
    if (missing.length > 0) throw new Error(`The SQLite engine lacks ${missing.join(', ')}.`);
  } finally {
    database.close();
  }
  selected = true;
};

export const checkEngine = (database: Database): void => {
  const source = database.query<{ source: string }, []>('SELECT sqlite_source_id() AS source').get()?.source;
  if (source !== SOURCE_ID) throw new Error(`The SQLite source is ${source}; expected ${SOURCE_ID}.`);
};
