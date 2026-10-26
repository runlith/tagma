import { type FileLockFailure, LockBusy, LockLost, LockUnavailable } from '@runlith/file-lock/FileLock';
import { Data } from 'effect';

export class CredentialFileInvalid extends Data.TaggedError('CredentialFileInvalid')<{
  readonly path: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `Credential file ${this.path} is invalid: ${this.reason}`;
  }
}

export class CredentialFileFailed extends Data.TaggedError('CredentialFileFailed')<{
  readonly kind: 'read' | 'write' | 'locked';
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export type CredentialFileFault = CredentialFileInvalid | CredentialFileFailed;

export function credentialLockFailure<E>(failure: E | FileLockFailure): E | CredentialFileFailed {
  if (failure instanceof LockBusy) {
    return new CredentialFileFailed({
      kind: 'locked',
      reason: `Credential file lock ${failure.path} remained held for ${failure.waitedMs}ms`,
    });
  }
  if (failure instanceof LockLost) {
    return new CredentialFileFailed({
      kind: 'locked',
      reason: `Credential file lock ${failure.path} was taken over while this writer held it; the row it would have written is the winner's`,
    });
  }
  if (failure instanceof LockUnavailable) {
    return new CredentialFileFailed({
      kind: 'write',
      reason: `Cannot take the credential file lock ${failure.path}: ${failure.reason}`,
    });
  }
  return failure as E;
}
