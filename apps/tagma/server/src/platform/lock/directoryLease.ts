import { closeSync, openSync, rmSync } from 'node:fs';
import { closeOnExec, lockExclusive, lockShared, unlock } from '@runlith/file-lock/flock';

export function holdDirectory(path: string): (() => void) | null {
  const fd = openSync(path, 'r');
  closeOnExec(fd);
  if (lockShared(fd) === 'locked') return () => closeSync(fd);
  closeSync(fd);
  return null;
}

export function leaseDirectory(path: string): 'leased' | 'being-removed' {
  return holdDirectory(path) === null ? 'being-removed' : 'leased';
}

export function removeUnleased(path: string, leaving: (path: string) => void = () => undefined): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    if (lockExclusive(fd) === 'held') return false;
    leaving(path);
    rmSync(path, { recursive: true, force: true });
    return true;
  } finally {
    closeSync(fd);
  }
}

export function directoryLeased(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    if (lockExclusive(fd) === 'held') return true;
    unlock(fd);
    return false;
  } finally {
    closeSync(fd);
  }
}
