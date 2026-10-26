import { Service } from '@runlith/layer/key';
import type { SectionContribution, SectionsModule, SettingsSection } from '$lib/features/settings/section.js';

export class SectionRegistry extends Service<SectionRegistry>()('SectionRegistry', { tier: 'app' }) {
  readonly sections: readonly SettingsSection[];

  private readonly contributions: readonly SectionContribution[];

  constructor(modules: Readonly<Record<string, SectionsModule>>) {
    super();
    const owners = new Map<string, string>();
    const sections: SettingsSection[] = [];
    const contributions: { readonly from: string; readonly contribution: SectionContribution }[] = [];
    for (const [path, module] of Object.entries(modules)) {
      for (const section of module.sections ?? []) {
        const owner = owners.get(section.id);
        if (owner !== undefined) throw new Error(`The settings section ${section.id} is declared by ${owner} and again by ${path}.`);
        owners.set(section.id, path);
        sections.push(section);
      }
      for (const contribution of module.contributions ?? []) contributions.push({ from: path, contribution });
    }
    for (const { from, contribution } of contributions) {
      if (!owners.has(contribution.section)) {
        throw new Error(`${from} contributes to the settings section ${contribution.section}, which no feature declares.`);
      }
    }
    this.sections = sections.sort((left, right) => left.order - right.order);
    this.contributions = contributions.map(({ contribution }) => contribution).sort((left, right) => left.order - right.order);
  }

  find(id: string): SettingsSection | undefined {
    return this.sections.find((section) => section.id === id);
  }

  contributionsTo(section: string): readonly SectionContribution[] {
    return this.contributions.filter((contribution) => contribution.section === section);
  }
}
