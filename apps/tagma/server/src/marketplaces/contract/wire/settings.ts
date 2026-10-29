import { Schema } from 'effect';
import { settingListKey } from '../../../platform/contract/wire/setting.js';
import { MarketplaceId, MarketplaceSource, TRUST_LABELS } from './rows.js';

export const MarketplaceAdded = Schema.Struct({
  id: MarketplaceId,
  source: MarketplaceSource,
  label: Schema.Literals(TRUST_LABELS),
  title: Schema.optional(Schema.String),
});
export type MarketplaceAdded = typeof MarketplaceAdded.Type;

export const marketplacesAdded = settingListKey({
  id: 'marketplaces.added',
  order: 775,
  title: 'Added',
  description: 'The plugin marketplaces this machine reads: where each is fetched from and Tagma’s trust label for it.',
  control: { kind: 'managed', by: 'add_marketplace' },
  member: MarketplaceAdded,
  fallback: [] as readonly MarketplaceAdded[],
  scopes: ['user'],
  merge: 'replace',
});

export const marketplacesPresets = settingListKey({
  id: 'marketplaces.presets',
  order: 776,
  title: 'Presets registered',
  description: 'The preset marketplaces already registered once; one removed afterwards is not registered again.',
  control: { kind: 'managed', by: 'remove_marketplace' },
  member: MarketplaceId,
  fallback: [] as readonly string[],
  scopes: ['user'],
  merge: 'replace',
});

export const MARKETPLACE_SETTING_SECTIONS = [
  {
    id: 'marketplaces',
    order: 64,
    title: 'Marketplaces',
    description: 'The plugin marketplaces this machine reads, and the presets it registered once.',
  },
] as const;
