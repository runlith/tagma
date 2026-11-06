import { providers as declaration } from './contract/wire/module.js';
import { providersVerbs } from './cli.js';
import { Context, Effect, Stream } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { ACCOUNTS_FEED } from './contract/wire/accounts.js';
import { CATALOG_FEED } from './contract/wire/catalog.js';
import { AccountQuota } from './contract/service/quota.js';
import { ProviderRegistry } from './contract/service/registry.js';
import type { AccountsLive } from './contract/service/live.js';
import { adaptersCapability } from './contract/wire/capability.js';
import { PROVIDER_SETTING_KEYS, PROVIDER_SETTING_SECTIONS } from './contract/wire/settings.js';

const FEEDS = [ACCOUNTS_FEED, CATALOG_FEED] as const;

const live: AccountsLive = liveOf(FEEDS, (door) => ({
  'accounts.subscribe': () => Context.get(door, AccountQuota).changes,
  'catalog.subscribe': () => {
    const registry = Context.get(door, ProviderRegistry);
    return Stream.unwrap(
      Effect.as(
        registry.recheck,
        Stream.map(registry.changes, (catalog) => catalog.served),
      ),
    );
  },
}));

export const providers = manifest({
  ...declaration,
  verbs: providersVerbs,
  capabilities: [adaptersCapability],
  settings: [...PROVIDER_SETTING_KEYS],
  settingSections: PROVIDER_SETTING_SECTIONS,
  snapshots: async (home) => (await import('./credentials/snapshot.js')).credentialParticipant(home.credentials),
  bodies: async () => Object.values((await import('./operations.js')).PROVIDER_PAIRS),
  live,
  tables: async () => {
    const [{ accountQuotaReading, adapterInstance, consoleKey, defaultAccount }] = await Promise.all([import('./store/tables.js')]);
    return { entities: [adapterInstance, consoleKey, defaultAccount, accountQuotaReading], history: [] };
  },
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ providersLayer }) => providersLayer,
    ),
  },
});
