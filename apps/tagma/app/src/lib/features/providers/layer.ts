import { Layer } from '@runlith/layer/Layer';
import { SettingSections } from '$lib/features/settings/section.js';
import { AccountsRepo } from './AccountsRepo.js';
import { AdaptersRepo } from './adapters/AdaptersRepo.js';
import { ProviderCatalog } from './Catalog.svelte.js';
import { CountdownClock } from './accounts/CountdownClock.svelte.js';
import { LoginObserver } from './LoginObserver.svelte.js';
import { sections } from './settings.js';
import { UsageAccounts } from './usage/Accounts.svelte.js';

export const AccountsLayer = Layer.mergeAll(
  SettingSections.contribute('providers', ...sections),
  ProviderCatalog,
  AccountsRepo,
  AdaptersRepo,
  UsageAccounts,
  CountdownClock,
  LoginObserver,
);
