import { Context } from 'effect';
import type { ProviderCatalog } from './registry.js';
import type { TokenStore } from '@runlith/llm/oauth/FileTokenStore';
import type { ConsoleKeyStore } from '../../credentials/consoleKeys.js';
import type { AccountQuotaProvider } from '../../quota/ledger.js';

export class CredentialFiles extends Context.Service<CredentialFiles, { readonly tokensPath: string }>()(
  'tagma/providers/CredentialFiles',
) {}

export class QuotaProviders extends Context.Service<QuotaProviders, { readonly providers: readonly AccountQuotaProvider[] }>()(
  'tagma/providers/QuotaProviders',
) {}

export class KeyedProviders extends Context.Service<KeyedProviders, { readonly ids: ReadonlyArray<string> }>()(
  'tagma/providers/KeyedProviders',
) {}

export class ProviderCredentials extends Context.Service<
  ProviderCredentials,
  {
    readonly tokens: TokenStore;
    readonly owned: TokenStore;
    forCatalog(catalog: ProviderCatalog): TokenStore;
    readonly keys: ConsoleKeyStore;
    consoles(): ReadonlyArray<string>;
  }
>()('tagma/providers/ProviderCredentials') {}
