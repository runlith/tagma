import type { CatalogCategory, EntryRow, MarketplaceRow } from '@tagma/server/marketplaces/contract/wire/rows';

export type Listing = {
  readonly entry: EntryRow;
  readonly marketplace: MarketplaceRow | undefined;
  readonly also: readonly EntryRow[];
};

const identity = (entry: EntryRow): string => (entry.plugin ?? entry.name).toLowerCase();

export const titleOf = (entry: EntryRow): string => entry.title ?? entry.name;

export function listingsOf(marketplaces: readonly MarketplaceRow[], entries: readonly EntryRow[]): readonly Listing[] {
  const rank = new Map(marketplaces.map((marketplace, at) => [marketplace.id, at]));
  const byId = new Map(marketplaces.map((marketplace) => [marketplace.id, marketplace]));
  const last = marketplaces.length;
  const ordered = entries
    .filter((entry) => entry.state !== 'refused')
    .toSorted((left, right) => (rank.get(left.marketplace) ?? last) - (rank.get(right.marketplace) ?? last));
  const groups = new Map<string, EntryRow[]>();
  for (const entry of ordered) {
    const key = identity(entry);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  return [...groups.values()].flatMap(([entry, ...also]) =>
    entry === undefined ? [] : [{ entry, marketplace: byId.get(entry.marketplace), also }],
  );
}

export function matching(listings: readonly Listing[], query: string): readonly Listing[] {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '');
  if (words.length === 0) return listings;
  return listings.filter(({ entry }) => {
    const text = [entry.name, entry.title, entry.description, entry.category, entry.author].join(' ').toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

type Category = { readonly name: string; readonly count: number };

const OTHER: CatalogCategory = 'Other';

export function categoriesOf(listings: readonly Listing[]): readonly Category[] {
  const counts = new Map<string, number>();
  for (const { entry } of listings) {
    if (entry.category === null) continue;
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted(
      (left, right) =>
        Number(left.name === OTHER) - Number(right.name === OTHER) || right.count - left.count || left.name.localeCompare(right.name),
    );
}
