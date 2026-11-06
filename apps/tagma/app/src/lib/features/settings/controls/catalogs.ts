import type { SettingChoiceSet } from '@tagma/server/platform/contract/wire/setting';
import type { KeyClass } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';

export type CatalogEntry = {
  readonly value: string;
  readonly label: string;
  readonly group: string;
  readonly swatches: readonly string[];
};

export interface ChoiceSource {
  readonly entries: readonly CatalogEntry[];
}

type ChoiceSet = { readonly of: SettingChoiceSet; readonly source: KeyClass<string, ChoiceSource> };

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
