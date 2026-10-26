import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { lockExclusive, unlock } from '@runlith/file-lock/flock';
import { join } from 'node:path';
import { pidAlive } from '@runlith/utils/process';
import { LOCK_FILE, type DirectoryHolder } from '../contract/wire/lock.js';
import { LEGACY_CLAIM_FILE, pidOf } from './dataDirectory.js';

const livePid = (path: string): number | null => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const pid = pidOf(text);
  return pid !== null && pidAlive(pid) ? pid : null;
};

export const dataDirectoryHolder = (dataPath: string): number | null =>
  livePid(join(dataPath, LOCK_FILE)) ?? livePid(join(dataPath, LEGACY_CLAIM_FILE));

export const dataDirectoryLocked = (dataPath: string): DirectoryHolder => {
  const path = join(dataPath, LOCK_FILE);
  if (!existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    if (lockExclusive(fd) === 'locked') {
      unlock(fd);
      return null;
    }
    return dataDirectoryHolder(dataPath) ?? 'unnamed';
  } finally {
    closeSync(fd);
  }
};
