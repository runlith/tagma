import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { type AccountSchemes, makeFileTokenStore, type TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import type { SubscriptionAccounts } from '@runlith/llm/oauth/vendor';
import type { HttpClient } from 'effect/http';
import type { Layer } from 'effect';
import type { Provider } from '@runlith/tagma/adapter/provider';

export const accountSchemes =
  (wires: () => ModelCatalog<Provider>): AccountSchemes =>
  (provider: string): SubscriptionAccounts | undefined => {
    const current = wires();
    if (!current.registered(provider)) return undefined;
    const registration = current.named(provider);
    return registration.kind === 'harness' && registration.auth === 'cli' ? undefined : registration.accounts;
  };

export function createProviderTokens(
  filePath: string,
  wires: () => ModelCatalog<Provider>,
  wire: Layer.Layer<HttpClient.HttpClient>,
  refreshing: () => ModelCatalog<Provider> = wires,
): TokenStore {
  return makeFileTokenStore({ path: filePath, schemes: accountSchemes(wires), wire, refreshing: accountSchemes(refreshing) });
}
