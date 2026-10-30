import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PluginResolved } from '../../../plugins/contract/service/plugins.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { MarketplaceList } from './lists.js';
import type { MarketplacePreset } from '../wire/presets.js';
import type { EntryRow, MarketplaceRow, MarketplaceSource } from '../wire/rows.js';

export class MarketplacePlaces extends Context.Service<MarketplacePlaces, { readonly home: string }>()(
  'tagma/marketplaces/MarketplacePlaces',
) {}

export class MarketplacePresets extends Context.Service<MarketplacePresets, readonly MarketplacePreset[]>()(
  'tagma/marketplaces/MarketplacePresets',
) {}

type Stored = SettingLandRefusal | 'setting-scope' | 'setting-value';

export type AddRefusal = 'marketplace-taken' | 'marketplace-unreachable' | 'marketplace-unreadable' | Stored;
export type RemoveRefusal = 'marketplace-unknown' | 'marketplace-unreachable' | Stored;
export type RefreshRefusal = 'marketplace-unknown' | 'marketplace-unreachable' | 'marketplace-unreadable';

export type EntryRefusal = 'marketplace-unknown' | 'marketplace-unfetched' | 'marketplace-entry-unknown' | 'marketplace-entry-refused';

export type MarketplaceFailure<Code extends string> = StoreFailure | GateRefusal<Code>;

export type Picked = { readonly entry: EntryRow; readonly resolved: PluginResolved };

export class Marketplaces extends Context.Service<
  Marketplaces,
  {
    rows(): Effect.Effect<readonly MarketplaceRow[], StoreFailure>;
    entries(marketplace: string | null): Effect.Effect<readonly EntryRow[], StoreFailure>;
    add(source: MarketplaceSource): Effect.Effect<MarketplaceRow, MarketplaceFailure<AddRefusal>>;
    remove(id: string): Effect.Effect<MarketplaceRow, MarketplaceFailure<RemoveRefusal>>;
    refresh(id: string): Effect.Effect<MarketplaceRow, MarketplaceFailure<RefreshRefusal>>;
    look(
      source: MarketplaceSource,
    ): Effect.Effect<MarketplaceList | null, MarketplaceFailure<'marketplace-unreachable' | 'marketplace-unreadable'>>;
    entry<A, E, R>(
      marketplace: string,
      name: string,
      use: (picked: Picked) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | MarketplaceFailure<EntryRefusal>, R>;
    readonly changes: Stream.Stream<void>;
  }
>()('tagma/marketplaces/Marketplaces') {}
