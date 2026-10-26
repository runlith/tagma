import type { CommentPolicy } from '@runlith/source-comments';
import { Context } from 'effect';
import type { Assembly, DoctrineSection } from '../wire/section.js';

export type SectionAssemblies = { readonly [Name in Assembly]: readonly string[] };

export type SectionCatalog = {
  readonly sections: Readonly<Record<string, DoctrineSection>>;
  readonly assemblies: SectionAssemblies;
};

export type LawRender = {
  readonly checkout?: 'shared' | 'single';
  readonly autoCommit?: boolean;
  readonly comments?: CommentPolicy;
  readonly graphOverCode?: boolean;
};

export type DoctrineText = {
  readonly contributed: SectionCatalog;
  readonly law: (render: LawRender) => readonly string[];
};

export class DoctrineMissing extends Error {
  constructor() {
    super('The doctrine was asked for text this context was never given; composition provides Doctrine.');
    this.name = 'DoctrineMissing';
  }
}

export const Doctrine = Context.Reference<DoctrineText | null>('tagma/platform/Doctrine', { defaultValue: () => null });

export function doctrineOf(doctrine: DoctrineText | null): DoctrineText {
  if (doctrine === null) throw new DoctrineMissing();
  return doctrine;
}
