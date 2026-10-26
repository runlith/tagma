import type { SettingChoiceSet } from '@tagma/server/platform/contract/wire/setting';
import { Service } from '@runlith/layer/key';
import { TERMINAL_THEME_CATALOG } from '$lib/shared/terminalThemes.js';

export type CatalogEntry = {
  readonly value: string;
  readonly label: string;
  readonly group: string;
  readonly swatches: readonly string[];
};

export type ModelChoiceSet = Exclude<SettingChoiceSet, 'terminal-theme'>;

export interface ChoicesPort {
  entries(of: ModelChoiceSet): readonly CatalogEntry[];
}

export class ModelChoices extends Service<ChoicesPort>()('ModelChoices', { tier: 'app' }) {}

const themes: readonly CatalogEntry[] = TERMINAL_THEME_CATALOG.map((entry) => ({
  value: entry.name,
  label: entry.name,
  group: entry.slot === 'dark' ? 'Dark' : 'Light',
  swatches: [
    entry.theme.black,
    entry.theme.red,
    entry.theme.green,
    entry.theme.yellow,
    entry.theme.blue,
    entry.theme.magenta,
    entry.theme.cyan,
    entry.theme.white,
  ].filter((colour): colour is string => colour !== undefined),
}));

export function catalogEntries(of: SettingChoiceSet, models: ChoicesPort): readonly CatalogEntry[] {
  return of === 'terminal-theme' ? themes : models.entries(of);
}

export function catalogGroups(entries: readonly CatalogEntry[]): readonly { label: string; entries: readonly CatalogEntry[] }[] {
  const groups: { label: string; entries: CatalogEntry[] }[] = [];
  for (const entry of entries) {
    const group = groups.find((held) => held.label === entry.group);
    if (group) group.entries.push(entry);
    else groups.push({ label: entry.group, entries: [entry] });
  }
  return groups;
}
