import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ENTRY_SCRIPT, entryPath } from '../contract/wire/junction.js';

export type EntryPlaced =
  | { readonly _tag: 'Placed' | 'Standing'; readonly path: string }
  | { readonly _tag: 'Unplaced'; readonly detail: string };

const standing = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

export const placeEntry = (env: NodeJS.ProcessEnv): EntryPlaced => {
  const path = entryPath(env);
  if (path === null) return { _tag: 'Unplaced', detail: 'HOME names no place for the entry point' };
  if (standing(path) === ENTRY_SCRIPT) return { _tag: 'Standing', path };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const beside = `${path}.${process.pid}.tmp`;
    writeFileSync(beside, ENTRY_SCRIPT, { mode: 0o755 });
    chmodSync(beside, 0o755);
    renameSync(beside, path);
  } catch (cause) {
    return { _tag: 'Unplaced', detail: `${path}: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  return { _tag: 'Placed', path };
};
