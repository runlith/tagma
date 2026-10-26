import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ProviderRegistry } from '../contract/service/registry.js';
import type { SignIns } from '../contract/service/signIns.js';
import type { HarnessAccounts } from '../contract/service/harness.js';

export const harnessSignIns = (
  signing: SignIns['Service'],
  book: HarnessAccounts['Service'],
  registry: ProviderRegistry['Service'],
): SignIns['Service'] => {
  const owns = (provider: string) =>
    Effect.map(registry.catalog, ({ harnesses }) =>
      harnesses.some((row) => row.id === provider && row.auth === 'cli' && row.accounts !== undefined),
    );
  return {
    ...signing,
    status: Effect.fnUntraced(function* () {
      const ordinary = yield* signing.status();
      const providers = (yield* registry.catalog).harnesses.filter((row) => row.auth === 'cli' && row.accounts !== undefined);
      const directory = yield* Effect.forEach(providers, (provider) =>
        Effect.map(book.status(provider.id), (rows) => [provider.id, rows] as const),
      );
      return { ...ordinary, ...Object.fromEntries(directory) };
    }),
    begin: (provider, projectId, account, method) =>
      Effect.flatMap(owns(provider), (owned) =>
        owned
          ? method === undefined || method === 'external-cli'
            ? book.begin(provider, projectId, account)
            : Effect.fail(
                new GateRefusal('sign-in-failed', `The provider does not declare sign-in method ${method}.`, ['choose external-cli']),
              )
          : signing.begin(provider, projectId, account, method),
      ),
    complete: (provider, account, code) =>
      Effect.flatMap(owns(provider), (owned) => (owned ? book.complete(provider, account) : signing.complete(provider, account, code))),
    remove: (provider, account) =>
      Effect.flatMap(owns(provider), (declared) =>
        declared
          ? book.remove(provider, account)
          : registry.current().models.registered(provider)
            ? signing.remove(provider, account)
            : Effect.flatMap(book.owns(provider, account), (stored) =>
                stored ? book.remove(provider, account) : signing.remove(provider, account),
              ),
      ),
    rename: (provider, account, label) =>
      Effect.flatMap(owns(provider), (owned) => (owned ? book.rename(provider, account, label) : signing.rename(provider, account, label))),
  };
};
