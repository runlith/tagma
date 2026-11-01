import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { SettableScope } from '@tagma/server/platform/contract/wire/setting';
import type { HostKind } from '@runlith/layer/Host';
import { Point } from '@runlith/layer/Point';
import type { Shown } from '@runlith/layer/svelte/payload';
import type { Component } from 'svelte';
import type { Gated } from '$lib/wire/access.js';
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

export interface SectionContribution extends Shown<SectionProps>, Gated<Shown<SectionProps>['payload']> {
  readonly id: string;
  readonly section: string;
  readonly order: number;
}

export const SettingSections = Point.define<SettingsSection>()('SettingSections', {
  tier: 'app',
  key: (section) => section.id,
  order: (section) => section.order,
  claims: (section) => (section.keys ?? []).map((key) => `Setting "${key}"`),
});

export const SectionContributions = Point.define<SectionContribution>()('SectionContributions', {
  tier: 'app',
  key: (contribution) => contribution.id,
  order: (contribution) => contribution.order,
});

export function pick(entries: readonly SettingEntry[], ids: readonly string[]): readonly SettingEntry[] {
  return ids.flatMap((id) => entries.filter((entry) => entry.id === id));
}

export function rest(entries: readonly SettingEntry[], claimed: readonly string[]): readonly SettingEntry[] {
  return entries.filter((entry) => !claimed.includes(entry.id));
}
