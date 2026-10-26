import { Effect, FileSystem } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const SOURCE = new Set(['.ts', '.tsx', '.mts', '.svelte']);
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', '.svelte-kit', '.external', '.git']);

export const sources = Effect.fn('sources.read')(function* (
  dirs: readonly string[],
  read: (path: string, text: string) => void,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const pending = [...dirs];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const current = dir;
    const entries = yield* Effect.sync(() => readdirSync(current, { withFileTypes: true }));
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(path);
        continue;
      }
      if (!entry.isFile() || !SOURCE.has(extname(entry.name))) continue;
      read(path, yield* fileSystem.readFileString(path));
    }
  }
});
