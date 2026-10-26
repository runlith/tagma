import { makeFileTokenStore, type TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import { type SubscriptionAccounts, subscriptionAccounts } from '@runlith/llm/oauth/vendor';
import { vendorWire } from '@runlith/llm/oauth/vendorCall';
import { SUBSCRIPTION_PROVIDER } from '@runlith/builtin-catalog/subscription/description';
import { subscriptionAccounts as testSubscription } from '@runlith/builtin-catalog/subscription/provider';
import { openaiAccounts } from '@runlith/adapter-openai/oauth/vendors/openai';
import { ProviderCredentials } from '../contract/service/credentials.js';
import { Effect } from 'effect';

const SHIPPED: Readonly<Record<string, SubscriptionAccounts>> = {
  [SUBSCRIPTION_PROVIDER]: subscriptionAccounts(testSubscription),
  'openai-oauth': subscriptionAccounts(openaiAccounts),
};

export type TestRefresh = NonNullable<SubscriptionAccounts['refresh']>;

export const testTokens = (path: string, options: { readonly refresh?: Readonly<Record<string, TestRefresh>> } = {}): TokenStore =>
  makeFileTokenStore({
    path,
    schemes: (provider) => {
      const scheme = SHIPPED[provider];
      const refresh = options.refresh?.[provider];
      return scheme === undefined || refresh === undefined ? scheme : { ...scheme, refresh };
    },
    wire: vendorWire,
  });

export const testCredentials = (tokens: TokenStore): ProviderCredentials['Service'] =>
  ProviderCredentials.of({
    tokens,
    owned: tokens,
    forCatalog: () => tokens,
    consoles: () => [],
    keys: {
      accounts: () => Effect.die('this fixture reads no console keys'),
      has: () => Effect.die('this fixture reads no console keys'),
      key: () => Effect.die('this fixture reads no console keys'),
      values: () => Effect.die('this fixture reads no console keys'),
      removeProviders: () => Effect.die('this fixture removes no console keys'),
      save: () => Effect.die('this fixture saves no console keys'),
      remove: () => Effect.die('this fixture removes no console keys'),
      moveKeys: () => Effect.die('this fixture moves no console keys'),
    },
  });
