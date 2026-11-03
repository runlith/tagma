import { closeSync, constants, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeOnExec, lockExclusive, unlock } from '@runlith/file-lock/flock';

const READ_ATTEMPTS = 3;
const READ_PAUSE_MS = 5;

export type Recorded = { readonly pid: number };

export type RecordedTaken<R> =
  | { readonly _tag: 'Taken'; readonly release: () => void }
  | { readonly _tag: 'Held'; readonly holder: R | null }
  | { readonly _tag: 'Unlocked'; readonly detail: string };

const heldBy = <R>(read: () => R | null): R | null => {
  for (let attempt = 0; ; attempt += 1) {
    const holder = read();
    if (holder !== null || attempt >= READ_ATTEMPTS) return holder;
    Bun.sleepSync(READ_PAUSE_MS);
  }
};

const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const takeRecorded = <R extends Recorded>(
  lock: string,
  record: string,
  own: R,
  read: () => R | null,
  retain = false,
): RecordedTaken<R> => {
  let fd: number;
  try {
    mkdirSync(dirname(lock), { recursive: true });
    fd = openSync(lock, constants.O_RDWR | constants.O_CREAT, 0o600);
  } catch (cause) {
    return { _tag: 'Unlocked', detail: `${lock}: ${said(cause)}` };
  }
  try {
    closeOnExec(fd);
    if (lockExclusive(fd) === 'held') {
      closeSync(fd);
      return { _tag: 'Held', holder: heldBy(read) };
    }
    const beside = `${record}.${own.pid}.tmp`;
    writeFileSync(beside, `${JSON.stringify(own)}\n`, { mode: 0o600 });
    renameSync(beside, record);
  } catch (cause) {
    closeSync(fd);
    return { _tag: 'Unlocked', detail: `${lock}: ${said(cause)}` };
  }
  let released = false;
  return {
    _tag: 'Taken',
    release: () => {
      if (released) return;
      released = true;
      try {
        if (!retain && read()?.pid === own.pid) rmSync(record, { force: true });
      } finally {
        unlock(fd);
        closeSync(fd);
      }
    },
  };
};

export const recordedHolder = <R>(lock: string, read: () => R | null): R | 'unnamed' | null => {
  if (!existsSync(lock)) return null;
  const fd = openSync(lock, constants.O_RDONLY);
  try {
    if (lockExclusive(fd) === 'locked') {
      unlock(fd);
      return null;
    }
    return heldBy(read) ?? 'unnamed';
  } finally {
    closeSync(fd);
  }
};
