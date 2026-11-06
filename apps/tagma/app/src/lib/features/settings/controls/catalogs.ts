import type { Resolver } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';

export type CatalogEntry = {
  readonly value: string;
  readonly label: string;
  readonly group: string;
  readonly swatches: readonly string[];
};

type ChoiceSet = { readonly of: string; readonly entries: (app: Resolver) => readonly CatalogEntry[] };

export const ChoiceSets = Point.define<ChoiceSet>()('ChoiceSets', { tier: 'app', key: (set) => set.of });

export function catalogGroups(entries: readonly CatalogEntry[]): readonly { label: string; entries: readonly CatalogEntry[] }[] {
  const groups: { label: string; entries: CatalogEntry[] }[] = [];
  for (const entry of entries) {
    const group = groups.find((held) => held.label === entry.group);
    if (group) group.entries.push(entry);
    else groups.push({ label: entry.group, entries: [entry] });
  }
  return groups;
}
