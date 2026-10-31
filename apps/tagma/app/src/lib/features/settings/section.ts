import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { HostKind } from '@runlith/layer/Host';
import type { Component } from 'svelte';
import type { SettingEntry, SettingsCatalog } from '$lib/features/settings/SettingsCatalog.svelte.js';

export type SectionProps = {
  catalog: SettingsCatalog;
  scope: SettableScope;
  project: Project | null;
};

export type SectionGroup = 'agent' | 'project' | 'machine' | 'interface';

export type SectionPlace = 'This machine' | 'This browser';

export type SettingsSection = {
  readonly id: string;
  readonly group: SectionGroup;
  readonly order: number;
  readonly icon: Component;
  readonly view?: Component<SectionProps>;
  readonly place?: SectionPlace;
  readonly local?: { readonly title: string; readonly description: string };
  readonly keys?: readonly string[];
  readonly standalone?: boolean;
  readonly hosts?: readonly HostKind[];
};

export type SectionContribution = {
  readonly section: string;
  readonly order: number;
  readonly view: Component<SectionProps>;
};

export type SectionsModule = {
  readonly sections?: readonly SettingsSection[];
  readonly contributions?: readonly SectionContribution[];
};

export function pick(entries: readonly SettingEntry[], ids: readonly string[]): readonly SettingEntry[] {
  return ids.flatMap((id) => entries.filter((entry) => entry.id === id));
}

export function rest(entries: readonly SettingEntry[], claimed: readonly string[]): readonly SettingEntry[] {
  return entries.filter((entry) => !claimed.includes(entry.id));
}
