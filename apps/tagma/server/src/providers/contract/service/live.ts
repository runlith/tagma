import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { ACCOUNTS_FEED } from '../wire/accounts.js';
import type { CATALOG_FEED } from '../wire/catalog.js';
import type { AccountQuota } from './quota.js';
import type { ProviderRegistry } from './registry.js';

export type AccountsLive = LiveDeclaration<readonly [typeof ACCOUNTS_FEED, typeof CATALOG_FEED], AccountQuota | ProviderRegistry>;
