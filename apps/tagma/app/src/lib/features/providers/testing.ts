import type { ServedProvider } from '@tagma/server/providers/contract/wire/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Scope } from '@runlith/layer/Scope';
import type { LiveConnection } from '$lib/wire/Live.js';
import { ProviderCatalog } from './Catalog.svelte.js';

type ServedFixture = Partial<ServedProvider> & {
  readonly id: string;
  readonly models: ServedProvider['models'];
  readonly defaultTextModel: string;
};

export function servedProvider(provider: ServedFixture): ServedProvider {
  return {
    label: provider.id,
    kind: 'wire',
    auth: 'oauth',
    icon: null,
    accountsLabel: null,
    signInMethods: (provider.auth ?? 'oauth') === 'oauth' ? ['loopback'] : provider.auth === 'api-key' ? ['key'] : ['external-cli'],
    keyHint: null,
    quotaFromReplies: false,
    cacheLifetime: { promisedSeconds: null, prior: null },
    accountSource: provider.id,
    ...provider,
  };
}

const ACCOUNTS_LABELS: Readonly<Record<string, string>> = {
  subscription: 'Claude',
  'openai-oauth': 'Codex',
};

export const SHIPPED_SERVED: readonly ServedProvider[] = DEFAULT_PROVIDER_DESCRIPTIONS.map(({ spell: _spell, ...description }) =>
  servedProvider({
    ...description,
    kind: description.auth === 'cli' ? 'harness' : 'wire',
    accountsLabel: ACCOUNTS_LABELS[description.id] ?? null,
    quotaFromReplies: description.id === 'stepfun',
  }),
);

export function testProviderCatalog(providers: readonly ServedProvider[] = SHIPPED_SERVED): ProviderCatalog {
  const live = {
    hold: (_open: unknown, onItem: (frame: unknown) => void) => {
      onItem({ providers, adapters: [], settings: [], sections: [] });
      return { unsubscribe: () => undefined };
    },
  } as unknown as LiveConnection;
  return new ProviderCatalog(live, Scope.make(), new Failure(() => undefined));
}

export const testProviders = (providers?: readonly ServedProvider[]) => Layer.of(ProviderCatalog, testProviderCatalog(providers));
