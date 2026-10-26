import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const STAGING = '.tmp';

export const STAGING_PATHSPEC = `:(exclude,glob)**/.*${STAGING}`;

export const stagingOf = (path: string): string => join(dirname(path), `.${basename(path)}${STAGING}`);

export const isStaging = (name: string): boolean => name.startsWith('.') && name.endsWith(STAGING);

export const changedDirectories = (directory: string, created: string | undefined): string[] => {
  const changed = [directory];
  if (created === undefined) return changed;
  for (let at = directory; at !== dirname(created) && at !== dirname(at); at = dirname(at)) changed.push(dirname(at));
  return changed;
};

export const writeAtomic = async (path: string, staging: string, text: string): Promise<string[]> => {
  const created = await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(staging, 'w');
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(staging, path);
  } catch (cause) {
    await rm(staging, { force: true });
    throw cause;
  }
  return changedDirectories(dirname(path), created);
};

export const writeAtomicSync = (path: string, staging: string, text: string): string[] => {
  const created = mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(staging, 'w');
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(staging, path);
  } catch (cause) {
    rmSync(staging, { force: true });
    throw cause;
  }
  return changedDirectories(dirname(path), created);
};

export const flushDirectories = async (directories: Iterable<string>): Promise<void> => {
  for (const directory of directories) {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
};

export const flushDirectoriesSync = (directories: Iterable<string>): void => {
  for (const directory of directories) {
    const fd = openSync(directory, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
};
