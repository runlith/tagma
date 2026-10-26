import { type CredentialFileFault, credentialLockFailure } from '@runlith/credential-file/failure';
import { type FileLockFailure, LockBusy, LockLost, LockUnavailable } from '@runlith/file-lock/FileLock';
import { Data } from 'effect';
import type { AccountKey } from '../models/authStatus.js';

export class TokenStoreFailed extends Data.TaggedError('TokenStoreFailed')<{
  readonly kind: 'read' | 'write' | 'refresh' | 'missing' | 'reconnect' | 'locked' | 'origin';
  readonly provider?: string;
  readonly account?: AccountKey;
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export type TokenStoreFault = TokenStoreFailed | CredentialFileFault;

export function storeLockFailure<E>(failure: E | FileLockFailure): E | TokenStoreFailed {
  if (!(failure instanceof LockBusy || failure instanceof LockLost || failure instanceof LockUnavailable)) return failure as E;
  const { kind, reason } = credentialLockFailure<never>(failure);
  return new TokenStoreFailed({ kind, reason });
}
