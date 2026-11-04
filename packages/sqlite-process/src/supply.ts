import { Database } from 'bun:sqlite';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Engine = { readonly prepare: () => Promise<void>; readonly select: () => void };

export type EngineFiles = { readonly library: string; readonly archive: string; readonly sources: readonly string[] };

const DENIED = new Set(['ENOENT', 'EACCES', 'EPERM', 'EROFS']);

const denied = (cause: unknown): boolean => cause instanceof Error && 'code' in cause && DENIED.has(String(cause.code));

const stamp = (paths: readonly string[]): string =>
  paths
    .map((path) => {
      const stat = statSync(path, { throwIfNoEntry: false });
      return stat === undefined ? '-' : `${stat.size}:${stat.mtimeMs}`;
    })
    .join(' ');

const read = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    if (denied(cause)) return undefined;
    throw cause;
  }
};

const record = (path: string, text: string): void => {
  try {
    writeFileSync(path, text);
  } catch (cause) {
    if (!denied(cause)) throw cause;
  }
};

export const supplied = (files: EngineFiles): Engine => {
  const verified = join(dirname(files.archive), 'build', `${process.platform}-${process.arch}`, 'verified');
  return {
    prepare: async () => {
      if (await Bun.file(files.archive).exists()) {
        const sources = stamp(files.sources);
        if (read(verified) === `${sources} ${stamp([files.library])}`) return;
        await (await import('./artifact.js')).buildEngine();
        if (stamp(files.sources) === sources) record(verified, `${sources} ${stamp([files.library])}`);
      } else if (!(await Bun.file(files.library).exists())) {
        throw new Error('The supplied SQLite native asset is missing from this program.');
      }
    },
    select: () => {
      try {
        if (!Database.setCustomSQLite(files.library)) {
          throw new Error('The supplied SQLite engine could not be selected before opening a database.');
        }
      } catch (cause) {
        if (!(cause instanceof Error) || !cause.message.startsWith('SQLite already loaded')) throw cause;
      }
    },
  };
};

export const embedded: Engine = { prepare: async () => undefined, select: () => undefined };
