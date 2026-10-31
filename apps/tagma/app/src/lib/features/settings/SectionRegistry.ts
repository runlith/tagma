import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { type SectionContribution, SectionContributions, SettingSections, type SettingsSection } from '$lib/features/settings/section.js';

type HolderIndex = { readonly items: readonly SettingsSection[]; readonly holders: ReadonlyMap<string, string> };

export class SectionRegistry extends Service<SectionRegistry>()('SectionRegistry', { tier: 'app' }) {
  static *make() {
    return new SectionRegistry(yield* SettingSections, yield* SectionContributions);
  }

  private indexed: HolderIndex | undefined;

  constructor(
    private readonly declared: Point<SettingsSection>,
    readonly contributions: Point<SectionContribution>,
  ) {
    super();
  }

  get sections(): readonly SettingsSection[] {
    return this.declared.items;
  }

  private get holders(): ReadonlyMap<string, string> {
    const items = this.declared.items;
    if (this.indexed?.items !== items) {
      this.indexed = { items, holders: new Map(items.flatMap((section) => (section.keys ?? []).map((key) => [key, section.id] as const))) };
    }
    return this.indexed.holders;
  }

  find(id: string): SettingsSection | undefined {
    return this.declared.find(id);
  }

  sectionOf(entry: { readonly id: string; readonly section: string }): string {
    return this.holders.get(entry.id) ?? entry.section;
  }
}
