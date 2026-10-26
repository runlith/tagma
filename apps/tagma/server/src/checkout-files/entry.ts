import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { PathEntry } from './contract/wire/place.js';

const ABSENT = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ENAMETOOLONG', 'ELOOP', 'ENXIO', 'ERR_INVALID_ARG_VALUE']);

const absent = (cause: unknown): boolean => ABSENT.has((cause as NodeJS.ErrnoException).code ?? '');

const directoryAt = async (path: string): Promise<PathEntry | null> => {
  try {
    return (await stat(path)).isDirectory() ? { kind: 'directory', path } : null;
  } catch (cause) {
    if (absent(cause)) return null;
    throw cause;
  }
};

export const entryAt = (path: string): Effect.Effect<PathEntry | null, GateRefusal<'files'>> =>
  Effect.tryPromise({
    try: async (): Promise<PathEntry | null> => {
      if (!isAbsolute(path)) return null;
      let file;
      try {
        file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EISDIR') return await directoryAt(path);
        if (absent(cause)) return null;
        throw cause;
      }
      try {
        const standing = await file.stat();
        if (standing.isDirectory()) return { kind: 'directory', path };
        if (!standing.isFile()) return null;
        return { kind: 'file', path, bytes: standing.size, mediaType: Bun.file(path).type || 'application/octet-stream' };
      } finally {
        await file.close();
      }
    },
    catch: (cause) =>
      new GateRefusal('files', `Cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, [
        'Check the path and its permissions.',
      ]),
  });
