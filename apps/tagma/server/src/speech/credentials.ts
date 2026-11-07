import { AccountKey } from '@runlith/llm/models/authStatus';
import { CredentialRefused, SpeechCredentials } from '@runlith/speech/engine/SpeechCredentials';
import { Effect, Layer } from 'effect';
import { DefaultAccounts } from '../providers/contract/service/accounts.js';
import { ProviderCredentials } from '../providers/contract/service/credentials.js';
import { chooseAccount } from '../providers/accounts/choice.js';

const unreadable = (provider: string, failure: { readonly message: string }) =>
  new CredentialRefused({
    provider,
    code: 'key-store',
    message: `the ${provider} keys could not be read: ${failure.message}`,
    unblock: ['try again; the key store was busy or unreadable this instant'],
    retryable: true,
  });

const missing = (provider: string) =>
  new CredentialRefused({
    provider,
    code: 'no-key',
    message: `no ${provider} API key is saved on this machine`,
    unblock: [`save a ${provider} API key with save_console_key`],
    retryable: false,
  });

export const credentialsLayer: Layer.Layer<SpeechCredentials, never, ProviderCredentials | DefaultAccounts> = Layer.effect(
  SpeechCredentials,
  Effect.gen(function* () {
    const { keys } = yield* ProviderCredentials;
    const defaults = yield* DefaultAccounts;
    return SpeechCredentials.of({
      get: Effect.fn('SpeechCredentials.get')(function* (provider, account) {
        const stored = (yield* Effect.mapError(keys.accounts(provider), (failure) => unreadable(provider, failure))).map(
          (row) => row.account,
        );
        const standing =
          account === undefined
            ? (yield* Effect.mapError(defaults.heldAccount(provider), (failure) => unreadable(provider, failure))).account
            : null;
        const choice =
          account === undefined
            ? chooseAccount(
                standing,
                stored.map((key) => AccountKey.make(key)),
              )
            : { kind: 'chosen' as const, account: AccountKey.make(account) };
        if (choice.kind === 'unsigned') return yield* missing(provider);
        if (choice.kind === 'ambiguous') {
          return yield* new CredentialRefused({
            provider,
            code: 'ambiguous-key',
            message: `${stored.length} ${provider} API keys are saved and none is the default`,
            unblock: [`make one of ${choice.keys.join(', ')} the default with set_default_account`],
            retryable: false,
          });
        }
        const key = yield* Effect.mapError(keys.key(provider, String(choice.account)), (failure) => unreadable(provider, failure));
        if (key === null) return yield* missing(provider);
        return { apiKey: key };
      }),
    });
  }),
);
