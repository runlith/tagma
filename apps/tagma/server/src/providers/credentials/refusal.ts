import { CredentialFileFailed, CredentialFileInvalid } from '@runlith/credential-file/failure';
import { TokenStoreFailed, type TokenStoreFault } from '@runlith/llm/oauth/storeFailure';
import { describeError } from '@runlith/utils/error';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

export const isTokenFault = (failure: unknown): failure is TokenStoreFault =>
  failure instanceof TokenStoreFailed || failure instanceof CredentialFileFailed || failure instanceof CredentialFileInvalid;

export const credentialRefusal = (what: string, cause: unknown): GateRefusal => {
  if (cause instanceof TokenStoreFailed) {
    switch (cause.kind) {
      case 'reconnect':
        return new GateRefusal('credential-reconnect', cause.message, [
          `sign in to ${cause.provider ?? 'the provider'} again with the sign-in mode its section selects`,
        ]);
      case 'missing':
        return new GateRefusal('unknown-account', cause.message, [
          `sign in to ${cause.provider ?? 'the provider'}, or choose an account its selected sign-in mode holds`,
        ]);
      case 'origin':
        return new GateRefusal('credential-origin', cause.message, [
          'manage the account in the CLI that holds it: a borrowed login is signed in, renamed and removed there',
        ]);
      default:
        return new GateRefusal('token-store', `The credential store could not ${what}: ${cause.message}`, [
          'try again; the store was busy, unreadable or unwritable this instant',
        ]);
    }
  }
  if (cause instanceof CredentialFileFailed) {
    return new GateRefusal('token-store', `The credential store could not ${what}: ${cause.message}`, [
      'try again; the store was busy, unreadable or unwritable this instant',
    ]);
  }
  if (cause instanceof CredentialFileInvalid) {
    return new GateRefusal('token-store', `The credential store could not ${what}: ${cause.message}`, [
      'read the token file named above: it is not the shape this version stores',
    ]);
  }
  return new GateRefusal('token-store', `The credential store could not ${what}: ${describeError(cause)}`, [
    'this is a defect below the credential store, not a gate: file it with the reason above',
  ]);
};
