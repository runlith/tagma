import { expect, test } from 'bun:test';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { CredentialFileFailed, CredentialFileInvalid } from '@runlith/credential-file/failure';
import { TokenStoreFailed } from '@runlith/llm/oauth/storeFailure';
import { credentialRefusal, isTokenFault } from './refusal.js';

const failed = (kind: TokenStoreFailed['kind'], reason: string) =>
  new TokenStoreFailed({
    kind,
    provider: 'openai-oauth',
    account: AccountKey.make('codex'),
    reason,
  });

test('a lost grant asks the provider it belongs to for a new sign-in, and a borrowed origin sends it to its CLI', () => {
  const reconnect = credentialRefusal('read its accounts', failed('reconnect', 'the reconnect case'));
  expect(reconnect.code).toBe('credential-reconnect');
  expect(reconnect.reason).toBe('the reconnect case');
  expect(reconnect.unblock.join(' ')).toContain('openai-oauth');

  const origin = credentialRefusal('read its accounts', failed('origin', 'the origin case'));
  expect(origin.code).toBe('credential-origin');
  expect(origin.reason).toBe('the origin case');
});

test('a missing row answers unknown-account, as every other door does', () => {
  const refusal = credentialRefusal('read its accounts', failed('missing', 'no such row'));

  expect(refusal.code).toBe('unknown-account');
  expect(refusal.unblock.join(' ')).toContain('openai-oauth');
});

test('a store kind answers try again, naming what it could not do', () => {
  for (const kind of ['read', 'write', 'locked', 'refresh'] as const) {
    const refusal = credentialRefusal('read its accounts', failed(kind, `the ${kind} case`));

    expect(refusal.code).toBe('token-store');
    expect(refusal.reason).toContain('could not read its accounts');
    expect(refusal.unblock.join(' ')).toContain('try again');
    expect(refusal.unblock.join(' ')).not.toContain('sign in');
  }
});

test('every credential store fault routes to a refusal and a bare defect never does', () => {
  expect(isTokenFault(failed('read', 'busy'))).toBe(true);
  expect(isTokenFault(new CredentialFileFailed({ kind: 'write', reason: 'disk full' }))).toBe(true);
  expect(isTokenFault(new CredentialFileInvalid({ path: '/t.json', reason: 'shape' }))).toBe(true);
  expect(isTokenFault(new TypeError('someBug is not a function'))).toBe(false);
});

test('an invalid file and a bare defect are told apart, and neither asks for a sign-in', () => {
  const invalid = credentialRefusal('read its accounts', new CredentialFileInvalid({ path: '/t.json', reason: 'v9' }));
  expect(invalid.code).toBe('token-store');
  expect(invalid.unblock.join(' ')).toContain('not the shape this version stores');

  const defect = credentialRefusal('read its accounts', new TypeError('someBug is not a function'));
  expect(defect.code).toBe('token-store');
  expect(defect.reason).toContain('someBug is not a function');
  expect(defect.unblock.join(' ')).toContain('defect');
});
