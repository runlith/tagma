import { AccountKey } from '@runlith/llm/models/authStatus';
import { subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { Effect, Schema } from 'effect';
import { CursorRefused, cursorIdentity } from './http';

export const credentialSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.Null,
  expiresAt: Schema.NullOr(Schema.Number),
  email: Schema.String,
});

const checkedKey = Effect.fn('cursor.checkKey')(function* (accessToken: string, expiresAt: number | null) {
  const identity = yield* cursorIdentity(accessToken);
  return { accessToken, refreshToken: null, expiresAt, email: identity.userEmail } as const;
});

export const accounts = subscriptionAccounts({
  credential: credentialSchema,
  key: (credential) => AccountKey.make(credential.email.toLowerCase()),
  label: (credential) => credential.email,
  signIns: [
    {
      kind: 'loopback',
      run: Effect.fn('cursor.login')(function* (openBrowser) {
        const login = yield* Effect.tryPromise({
          try: async (signal) => {
            const { Cursor } = await import('@cursor/sdk');
            return Cursor.auth.login({ openBrowser, onLoginUrl: openBrowser, store: null, apiKeyName: 'Tagma', signal });
          },
          catch: (cause) => new CursorRefused({ message: cause instanceof Error ? cause.message : String(cause) }),
        });
        return yield* checkedKey(login.apiKey, login.apiKeyExpiresAtMs);
      }),
    },
    { kind: 'key', store: (key) => checkedKey(key, null) },
  ],
});
