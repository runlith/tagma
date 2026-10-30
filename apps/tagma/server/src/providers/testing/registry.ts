import type { Provider, WireProvider } from '@runlith/tagma/adapter/provider';
import { Effect, Stream } from 'effect';
import { notInstalled, type ProviderCatalog, type ProviderRegistry } from '../contract/service/registry.js';
import { catalogOf } from '../registry.js';
import { modeSections } from '../accounts/modes.js';

export const providerCatalogOf = (providers: readonly Provider[]): ProviderCatalog =>
  catalogOf(
    [
      {
        state: { id: 'fixture', origin: 'builtin', version: null, state: 'loaded', providers: providers.map(({ id }) => id) },
        providers,
        settings: undefined,
      },
    ],
    new Map(),
    Effect.runSync(modeSections(providers)),
  );

export const staticRegistry = (catalog: ProviderCatalog): ProviderRegistry['Service'] => ({
  catalog: Effect.succeed(catalog),
  current: () => catalog,
  changes: Stream.make(catalog),
  registration: (provider) =>
    catalog.models.registered(provider) ? Effect.succeed(catalog.models.named(provider)) : Effect.fail(notInstalled(provider)),
  callable: (provider) =>
    catalog.models.registered(provider) ? Effect.succeed(catalog.models.named(provider)) : Effect.fail(notInstalled(provider)),
  pinRun: () => {},
  forRun: () => catalog,
  releaseRun: () => Effect.void,
  pinned: () => new Set(),
  reload: Effect.succeed(catalog),
  selectMode: () => Effect.die('the static catalog does not change account modes'),
  recheck: Effect.succeed(catalog),
  bindSignIns: () => Effect.void,
  updateCatalog: () => Effect.die('the static registry does not update catalogs'),
});

export const testRegistry = staticRegistry(
  providerCatalogOf([
    {
      id: 'test-provider',
      label: 'Test provider',
      kind: 'wire',
      auth: 'api-key',
      models: {
        'test-model': { label: 'Test model', capacity: { context: 64_000 }, capabilities: ['text'], reasoning: [], defaultReasoning: null },
      },
      cacheLifetime: { promisedSeconds: null, prior: null },
      defaultTextModel: 'test-model',
      profile: {
        model: () => Effect.die('The storage fixture does not call a model.'),
        options: () => undefined,
        output: { budget: 100, sent: false },
      },
      quota: { read: () => Effect.die('The storage fixture does not read quota.'), fromHeaders: () => null },
    } satisfies WireProvider,
  ]),
);
