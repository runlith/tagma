import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Result, Schema } from 'effect';
import { type Attempt, attemptSchema, type Return, returnSchema } from '../contract/wire/attempt.js';
import { ATTEMPT_FILE, RETURN_FILE } from '../contract/wire/layout.js';
import { absentPath } from './manifests.js';
import { currentVersion } from './versions.js';

const decodeAttempt = Schema.decodeUnknownResult(Schema.fromJsonString(attemptSchema));
const encodeAttempt = Schema.encodeSync(Schema.fromJsonString(attemptSchema));
const decodeReturn = Schema.decodeUnknownResult(Schema.fromJsonString(returnSchema));
const encodeReturn = Schema.encodeSync(Schema.fromJsonString(returnSchema));

const textAt = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (absentPath(error)) return null;
    throw error;
  }
};

const flushed = (path: string): void => {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const replaced = (path: string, text: string): void => {
  const passing = `${path}.${process.pid}`;
  const fd = openSync(passing, 'w', 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(passing, path);
  flushed(dirname(path));
};

const recorded = <A, E>(path: string, decoded: (text: string) => Result.Result<A, E>): A | null => {
  const text = textAt(path);
  if (text === null) return null;
  const read = decoded(text);
  if (Result.isSuccess(read)) return read.success;
  console.warn(`[tagma] ${path} does not read, so it stands for no record: ${String(read.failure)}`);
  return null;
};

export const readAttempt = (installRoot: string): Attempt | null => recorded(join(installRoot, ATTEMPT_FILE), decodeAttempt);

export const writeAttempt = (installRoot: string, attempt: Attempt): void =>
  replaced(join(installRoot, ATTEMPT_FILE), encodeAttempt(attempt));

export const openAttempt = (installRoot: string, from: string | null, to: string): void =>
  writeAttempt(installRoot, { from, to, starts: 0, copied: false, ended: null });

export const passAttempt = (installRoot: string, to: string): void => {
  if (readAttempt(installRoot)?.to !== to) return;
  rmSync(join(installRoot, ATTEMPT_FILE), { force: true });
  flushed(installRoot);
};

export const liveAttempt = (installRoot: string): Attempt | null => {
  const open = readAttempt(installRoot);
  return open !== null && open.ended === null && open.to === currentVersion(installRoot) ? open : null;
};

export const attemptHolds = (installRoot: string): readonly string[] => {
  const open = liveAttempt(installRoot);
  return open === null ? [] : [open.to, ...(open.from === null ? [] : [open.from])];
};

export const readReturn = (installRoot: string): Return | null => {
  const record = recorded(join(installRoot, RETURN_FILE), decodeReturn);
  return record !== null && record.to === currentVersion(installRoot) ? record : null;
};

export const writeReturn = (installRoot: string, left: string, to: string): void =>
  replaced(join(installRoot, RETURN_FILE), encodeReturn({ left, to }));

export const clearReturn = (installRoot: string): void => rmSync(join(installRoot, RETURN_FILE), { force: true });
