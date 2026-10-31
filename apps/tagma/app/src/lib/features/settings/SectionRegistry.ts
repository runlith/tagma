import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { type SectionContribution, SectionContributions, SettingSections, type SettingsSection } from '$lib/features/settings/section.js';

const holdersOf = (sections: readonly SettingsSection[]): ReadonlyMap<string, string> =>
  new Map(sections.flatMap((section) => (section.keys ?? []).map((key) => [key, section.id] as const)));

export class SectionRegistry extends Service<SectionRegistry>()('SectionRegistry', { tier: 'app' }) {
  static *make() {
    return new SectionRegistry(yield* SettingSections, yield* SectionContributions);
  }

  private readonly holding: () => ReadonlyMap<string, string>;

  constructor(
    private readonly declared: Point<SettingsSection>,
    readonly contributions: Point<SectionContribution>,
  ) {
    super();
    this.holding = declared.derive(holdersOf);
  }

  get sections(): readonly SettingsSection[] {
    return this.declared.items;
  }

  private get holders(): ReadonlyMap<string, string> {
    return this.holding();
  }

  find(id: string): SettingsSection | undefined {
    return this.declared.find(id);
  }

  sectionOf(entry: { readonly id: string; readonly section: string }): string {
    return this.holders.get(entry.id) ?? entry.section;
  }
}
