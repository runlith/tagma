import { Layer } from '@runlith/layer/Layer';
import { AccountsRepo } from './AccountsRepo.js';
import { AdaptersRepo } from './adapters/AdaptersRepo.js';
import { ProviderCatalog } from './Catalog.svelte.js';
import { CountdownClock } from './accounts/CountdownClock.svelte.js';
import { UsageAccounts } from './usage/Accounts.svelte.js';

export const AccountsLayer = Layer.mergeAll(ProviderCatalog, AccountsRepo, AdaptersRepo, UsageAccounts, CountdownClock);
