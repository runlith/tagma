import { tmpdir } from 'node:os';
import { Data } from 'effect';
import type { CommentPolicy } from '@runlith/source-comments';
import type { CheckoutMode } from '@runlith/agent-tools/workspace';
import type { DoctrineFact, DoctrineSection, Section, SectionContext } from '../../platform/contract/wire/section.js';
import type { DoctrineText, SectionCatalog } from '../../platform/contract/service/sections.js';
import { ContributionInvalid, contributions, isOwn, type SectionId, SECTIONS } from './registry.js';
import { type OperationTable, operationsSection } from './operationsSection.js';

export type WorldFacts = {
  readonly root: string;
  readonly shell: string;
  readonly platform: string;
};

export type SectionRender = {
  readonly checkout?: CheckoutMode;
  readonly comments?: CommentPolicy;
  readonly autoCommit?: boolean;
  readonly facts?: Readonly<Record<string, boolean>>;
  readonly identity?: string;
  readonly world?: WorldFacts;
  readonly graphOverCode?: boolean;
  readonly contributed?: SectionCatalog | null;
};

const userland = (platform: string) => (platform === 'darwin' ? 'BSD userland; sed, stat and date differ from GNU' : 'GNU userland');

export class SectionValueMissing extends Data.TaggedError('SectionValueMissing')<{ readonly value: string; readonly message: string }> {
  constructor(value: string) {
    super({ value, message: `A doctrine section asked for the ${value} this render does not carry.` });
  }
}

export function sectionContext(render: SectionRender = {}): SectionContext {
  return {
    get identity(): string {
      if (render.identity === undefined) throw new SectionValueMissing('identity');
      return render.identity;
    },
    get platform(): string {
      const platform = render.world?.platform ?? process.platform;
      return render.world === undefined ? `${platform} ${process.arch} (${userland(platform)})` : `${platform} (${userland(platform)})`;
    },
    get root(): string {
      return render.world?.root ?? tmpdir();
    },
    get shell(): string {
      return render.world?.shell ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
    },
    get commentsLaw(): string {
      return commentsLawSentence(render.comments ?? 'allowed');
    },
    autoCommit: render.autoCommit ?? false,
    sharedCheckout: (render.checkout ?? 'shared') === 'shared',
    op: (id) => id,
  };
}

function commentsLawSentence(policy: CommentPolicy): string {
  if (policy === 'forbid') {
    return 'No prose comment is written into this checkout: the door that lands a change drops any comment the change adds and names the lines. `//!` opens the one line whose why cannot be code, an exception you will be asked to defend; everything wider goes into the graph.';
  }
  return 'A comment explains something important the code does not make obvious, concisely and relevantly, never narrating straightforward actions or running into long prose; it carries enough detail to help the reader, since clarity and usefulness matter more than length or format.';
}

function sectionOf(id: SectionId, render: SectionRender): Section {
  const contributed = render.contributed?.sections[id] ?? (isOwn(id) ? SECTIONS[id] : undefined);
  if (contributed === undefined) throw new SectionValueMissing(`contribution of ${id}`);
  return contributed.render;
}

export function renderSection(id: SectionId, render: SectionRender = {}): string {
  return sectionOf(id, render)(sectionContext(render));
}

export function renderSections(ids: readonly SectionId[], render: SectionRender = {}): string[] {
  const enabled = {
    checkout: (render.checkout ?? 'shared') === 'shared',
    code: render.graphOverCode ?? true,
  } as const;
  const context = sectionContext(render);
  return ids.flatMap((id) => {
    const contributed = render.contributed?.sections[id];
    const condition = contributed?.when;
    const fact = contributed?.fact;
    if (fact !== undefined && render.facts?.[fact] !== true) return [];
    return condition === undefined || enabled[condition] ? [sectionOf(id, render)(context)] : [];
  });
}

export function doctrineText(contributed: SectionCatalog): DoctrineText {
  return {
    contributed,
    law: (render) => renderSections(contributed.assemblies.law, { ...render, contributed }),
  };
}

export const doctrineOf = (
  sections: readonly DoctrineSection[],
  facts: readonly DoctrineFact[],
  operations: readonly OperationTable[],
): DoctrineText => {
  const declared = new Set(facts.map((fact) => fact.id));
  for (const section of sections) {
    if (section.fact !== undefined && !declared.has(section.fact))
      throw new ContributionInvalid(section.id, `names the fact ${section.fact}, which no module declares`);
  }
  return doctrineText(contributions([...sections, operationsSection(operations)]));
};
