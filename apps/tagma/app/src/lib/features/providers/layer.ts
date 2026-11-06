import { Layer } from '@runlith/layer/Layer';
import { ChoiceSets } from '$lib/features/settings/controls/catalogs.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { AccountsRepo } from './AccountsRepo.js';
import { AdaptersRepo } from './adapters/AdaptersRepo.js';
import { ProviderCatalog } from './Catalog.svelte.js';
import { imageModels } from './choices.js';
import { CountdownClock } from './accounts/CountdownClock.svelte.js';
import { LoginObserver } from './LoginObserver.svelte.js';
import { sections } from './settings.js';
import { UsageAccounts } from './usage/Accounts.svelte.js';

export const AccountsLayer = Layer.mergeAll(
  SettingSections.contribute('providers', ...sections),
  ProviderCatalog,
  ChoiceSets.contribute('providers', { of: 'image-model', entries: imageModels }),
  AccountsRepo,
  AdaptersRepo,
  UsageAccounts,
  CountdownClock,
  LoginObserver,
);
