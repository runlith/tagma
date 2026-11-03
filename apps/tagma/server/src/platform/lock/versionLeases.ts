import { join } from 'node:path';
import { removeUnleased } from './directoryLease.js';
import { versionsNewestFirst } from './versionedDirectories.js';

export function pruneDirectories(
  root: string,
  names: readonly string[],
  keep: ReadonlySet<string>,
  forget: (dir: string) => void = () => undefined,
): void {
  for (const name of names) if (!keep.has(name)) removeUnleased(join(root, name), forget);
}

export function pruneVersions(root: string, keep: readonly string[], forget?: (dir: string) => void): void {
  pruneDirectories(root, versionsNewestFirst(root), new Set(keep), forget);
}
