import type { Role, Slot } from './declaration.js';
import type { SectionOrigin } from './sections.js';

export type SectionSource = { readonly type: string; readonly origin?: SectionOrigin };

export type Provenance = {
  readonly fields: Readonly<Record<string, string>>;
  readonly roles: Readonly<Partial<Record<Role, string>>>;
  readonly gates: readonly string[];
  readonly edges: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, string>>;
  readonly body: string;
  readonly open: Readonly<Record<Slot, string>>;
  readonly sections: readonly SectionSource[];
  readonly contracts: Readonly<Record<string, string>>;
};
