import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_NAME, SOURCE_ARCHIVE, SOURCE_ID } from './engine.js';

const ENGINE = fileURLToPath(new URL('./engine.ts', import.meta.url));
const HOME_LIBRARY = fileURLToPath(new URL('./sqlite.native', import.meta.url));
const HOME_RECEIPT = join(dirname(SOURCE_ARCHIVE), 'build', `${process.platform}-${process.arch}`, 'receipt.json');

const SCRIPT = `
import { Database } from 'bun:sqlite';
const { prepareEngineFrom, selectEngine } = await import(process.argv[1]);
await prepareEngineFrom(process.argv[2]);
selectEngine();
console.log(new Database(':memory:').query('SELECT sqlite_source_id() AS id').get().id);
`;

const run = (archive: string) => {
  const ran = Bun.spawnSync([process.execPath, '-e', SCRIPT, ENGINE, archive], { stdout: 'pipe', stderr: 'pipe' });
  return { code: ran.exitCode, out: ran.stdout.toString().trim(), error: ran.stderr.toString() };
};

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test.skipIf(process.platform !== 'darwin')(
  'an engine prepared from another version’s archive keeps its build beside that archive and refuses an archive that is not the pinned one',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'sqlite-engine-'));
    try {
      const held = [digest(HOME_LIBRARY), digest(HOME_RECEIPT)];
      const version = join(root, 'version');
      mkdirSync(join(version, 'build', `${process.platform}-${process.arch}`), { recursive: true });
      const archive = join(version, 'sqlite.zip');
      copyFileSync(SOURCE_ARCHIVE, archive);
      copyFileSync(HOME_LIBRARY, join(version, LIBRARY_NAME));
      copyFileSync(HOME_RECEIPT, join(version, 'build', `${process.platform}-${process.arch}`, 'receipt.json'));
      expect(run(archive)).toEqual({ code: 0, out: SOURCE_ID, error: '' });
      expect([digest(HOME_LIBRARY), digest(HOME_RECEIPT)]).toEqual(held);
      expect(existsSync(join(version, 'build', `${process.platform}-${process.arch}`, 'verified'))).toBe(true);

      const foreign = join(root, 'foreign');
      mkdirSync(foreign);
      const other = join(foreign, 'sqlite.zip');
      copyFileSync(SOURCE_ARCHIVE, other);
      appendFileSync(other, new Uint8Array([0]));
      const refused = run(other);
      expect(refused.code).not.toBe(0);
      expect(refused.error).toContain('The fixed SQLite source archive has digest');
      expect([digest(HOME_LIBRARY), digest(HOME_RECEIPT)]).toEqual(held);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
