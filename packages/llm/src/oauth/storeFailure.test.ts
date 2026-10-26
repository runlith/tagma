import { expect, test } from 'bun:test';
import { CredentialFileFailed } from '@runlith/credential-file/failure';
import { LockBusy } from '@runlith/file-lock/FileLock';
import { storeLockFailure, TokenStoreFailed } from './storeFailure';

test('a lock failure becomes a locked store failure and every other failure passes through as it is', () => {
  expect(storeLockFailure(new LockBusy({ path: '/t.lock', waitedMs: 15_000 }))).toMatchObject({ _tag: 'TokenStoreFailed', kind: 'locked' });

  const written = new CredentialFileFailed({ kind: 'write', reason: 'disk full' });
  expect(storeLockFailure(written)).toBe(written);
  const refused = new TokenStoreFailed({ kind: 'origin', reason: 'imported' });
  expect(storeLockFailure(refused)).toBe(refused);
});
