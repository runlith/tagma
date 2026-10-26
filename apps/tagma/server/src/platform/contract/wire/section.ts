import type { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';

export interface SectionContext {
  readonly identity: string;
  readonly platform: string;
  readonly root: string;
  readonly shell: string;
  readonly commentsLaw: string;
  readonly autoCommit: boolean;
  readonly sharedCheckout: boolean;
  op(id: string): string;
}

export type Section = (ctx: SectionContext) => string;

export type Assembly = 'prompt' | 'base' | 'law' | 'SKILL.md' | 'LIFECYCLE.md' | 'REVIEW.md' | 'ORCHESTRATION.md' | 'OPERATIONS.md';

export type SectionPlacement = { readonly [Name in Assembly]?: number } & (
  | { readonly base?: never }
  | { readonly base: number; readonly prompt: number }
);

export type DoctrineSection = {
  readonly id: string;
  readonly owner: string;
  readonly render: Section;
  readonly path: string;
  readonly place: SectionPlacement;
  readonly when?: SectionCondition;
  readonly fact?: string;
};

export type FactCheckout = { readonly projectId: number; readonly root: string };

export type DoctrineFact = {
  readonly id: string;
  readonly read: (checkout: FactCheckout) => Effect.Effect<boolean, never, Git>;
};

export type SectionCondition = 'checkout' | 'code';
