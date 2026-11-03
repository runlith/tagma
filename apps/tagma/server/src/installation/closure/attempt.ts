import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Data, Result, Schema } from 'effect';
import { type Attempt, attemptSchema, type Return, returnSchema, servingSchema } from '../contract/wire/attempt.js';
import { ATTEMPT_FILE, INSTALL_FILE, RETURN_FILE, SERVED_FILE } from '../contract/wire/layout.js';
import { absentPath } from './manifests.js';
import { currentVersion } from '../../platform/lock/versionedDirectories.js';

const decodeAttempt = Schema.decodeUnknownResult(Schema.fromJsonString(attemptSchema));
const encodeAttempt = Schema.encodeSync(Schema.fromJsonString(attemptSchema));
const decodeReturn = Schema.decodeUnknownResult(Schema.fromJsonString(returnSchema));
const encodeReturn = Schema.encodeSync(Schema.fromJsonString(returnSchema));
const decodeServed = Schema.decodeUnknownResult(Schema.fromJsonString(servingSchema));
const encodeServed = Schema.encodeSync(Schema.fromJsonString(servingSchema));

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

export class RecordUnreadable extends Data.TaggedError('RecordUnreadable')<{ readonly path: string; readonly detail: string }> {
  override get message(): string {
    return `${this.path} does not read as its record: ${this.detail}`;
  }
}

type Recorded<A> = Result.Result<A | null, RecordUnreadable>;

const recorded = <A, E>(path: string, decoded: (text: string) => Result.Result<A, E>): Recorded<A> => {
  const text = textAt(path);
  if (text === null) return Result.succeed(null);
  return Result.mapError(decoded(text), (failure) => new RecordUnreadable({ path, detail: String(failure) }));
};

export const readAttempt = (installRoot: string): Recorded<Attempt> => recorded(join(installRoot, ATTEMPT_FILE), decodeAttempt);

export const setAsideAttempt = (installRoot: string, stamp: number): string => {
  const aside = join(installRoot, `${ATTEMPT_FILE}.unread-${stamp}`);
  renameSync(join(installRoot, ATTEMPT_FILE), aside);
  flushed(installRoot);
  return aside;
};

export const writeAttempt = (installRoot: string, attempt: Attempt): void =>
  replaced(join(installRoot, ATTEMPT_FILE), encodeAttempt(attempt));

export const beginAttempt = (installRoot: string, from: string | null, to: string): void =>
  writeAttempt(installRoot, { from, to, starts: 0, copied: false, ended: null });

export const passAttempt = (installRoot: string, to: string): void => {
  const read = readAttempt(installRoot);
  if (Result.isFailure(read) || read.success?.to !== to) return;
  rmSync(join(installRoot, ATTEMPT_FILE), { force: true });
  flushed(installRoot);
};

export const stands = (attempt: Attempt, current: string | null): boolean =>
  attempt.to === current && (attempt.ended === null || attempt.ended.data === 'unrestored');

export const standingAttempt = (installRoot: string): Recorded<Attempt> =>
  Result.map(readAttempt(installRoot), (open) => (open !== null && stands(open, currentVersion(installRoot)) ? open : null));

export const attemptHolds = (installRoot: string): Result.Result<readonly string[], RecordUnreadable> =>
  Result.map(standingAttempt(installRoot), (open) => (open === null ? [] : [open.to, ...(open.from === null ? [] : [open.from])]));

export const readReturn = (installRoot: string): Recorded<Return> =>
  Result.map(recorded(join(installRoot, RETURN_FILE), decodeReturn), (record) =>
    record !== null && record.to === currentVersion(installRoot) ? record : null,
  );

export const writeReturn = (installRoot: string, left: string, to: string): void =>
  replaced(join(installRoot, RETURN_FILE), encodeReturn({ left, to }));

export const clearReturn = (installRoot: string): void => rmSync(join(installRoot, RETURN_FILE), { force: true });

export const writeServed = (installRoot: string, release: string): void =>
  replaced(join(installRoot, SERVED_FILE), encodeServed({ release }));

export const servedRelease = (installRoot: string): Recorded<string> =>
  Result.map(recorded(join(installRoot, SERVED_FILE), decodeServed), (served) =>
    served !== null && existsSync(join(installRoot, served.release, INSTALL_FILE)) ? served.release : null,
  );
