import type { Component } from 'svelte';
import type { SectionGroup } from '$lib/features/settings/section.js';
import type { SectionRegistry } from '$lib/features/settings/SectionRegistry.js';

export type ColumnSection = {
  readonly id: string;
  readonly title: string;
  readonly icon: Component;
  readonly count: number;
};

export type ColumnGroup = { readonly title: string; readonly sections: readonly ColumnSection[] };

const COLUMN_GROUPS: readonly { readonly id: SectionGroup; readonly title: string }[] = [
  { id: 'agent', title: 'Agent' },
  { id: 'project', title: 'Project' },
  { id: 'machine', title: 'Machine' },
  { id: 'interface', title: 'Interface' },
];

const OTHER_GROUP = 'Other';

export function columnGroups<Known extends { readonly id: string }>(
  declared: SectionRegistry,
  known: readonly Known[],
  row: (section: Known) => ColumnSection | null,
): readonly ColumnGroup[] {
  const byId = new Map(known.map((section) => [section.id, section]));
  const rows = (sections: readonly (Known | undefined)[]): ColumnSection[] =>
    sections.flatMap((section) => {
      const drawn = section === undefined ? null : row(section);
      return drawn === null ? [] : [drawn];
    });
  const drawn = COLUMN_GROUPS.map((group) => ({
    title: group.title,
    sections: rows(declared.sections.filter((section) => section.group === group.id).map((section) => byId.get(section.id))),
  }));
  const others = rows(known.filter((section) => declared.find(section.id) === undefined));
  return [...drawn, { title: OTHER_GROUP, sections: others }].filter((group) => group.sections.length > 0);
}
