import type { Change, Deadline } from '@runlith/utils/sequenceDiff';
import { prepareGap, prepareHunk, scanGaps, type GapScan, type GapWork, type HunkWork, type Step, type Unknown } from './folding.js';
import { netOf, type NetWindow, type NetWork } from './net.js';
import { alignBase, type BaseAlignment, type BaseWork } from './projection.js';
import { linksOf, type EditLink, type LinkWork } from './provenance.js';

export type FoldJob =
  | { readonly kind: 'hunk'; readonly work: HunkWork }
  | { readonly kind: 'gaps'; readonly work: GapScan }
  | { readonly kind: 'gap'; readonly work: GapWork }
  | { readonly kind: 'base'; readonly work: BaseWork }
  | { readonly kind: 'net'; readonly work: NetWork }
  | { readonly kind: 'links'; readonly work: LinkWork };
export type FoldAnswer =
  | { readonly kind: 'hunk'; readonly answer: Step | Unknown }
  | { readonly kind: 'gaps'; readonly answer: readonly Change[] | Unknown }
  | { readonly kind: 'gap'; readonly answer: Step | Unknown }
  | { readonly kind: 'base'; readonly answer: BaseAlignment }
  | { readonly kind: 'net'; readonly answer: readonly NetWindow[] | Unknown }
  | { readonly kind: 'links'; readonly answer: readonly EditLink[] | Unknown };
export type FoldWork<A> = Generator<FoldJob, A, FoldAnswer>;
export type FoldResponse = { readonly answer: FoldAnswer; readonly used: number };

type Answer<K extends FoldJob['kind']> = Extract<FoldAnswer, { readonly kind: K }>['answer'];
export function* askFold<K extends FoldJob['kind']>(job: Extract<FoldJob, { readonly kind: K }>): FoldWork<Answer<K>> {
  const response = yield job;
  if (response.kind !== job.kind) throw new Error(`fold job ${job.kind} received ${response.kind}`);
  return response.answer as Answer<K>;
}

export function answerFold(job: FoldJob, budget: Deadline): FoldAnswer {
  switch (job.kind) {
    case 'hunk':
      return { kind: job.kind, answer: prepareHunk(job.work, budget) };
    case 'gaps':
      return { kind: job.kind, answer: scanGaps(job.work, budget) };
    case 'gap':
      return { kind: job.kind, answer: prepareGap(job.work, budget) };
    case 'base':
      return { kind: job.kind, answer: alignBase(job.work, budget) };
    case 'net':
      return { kind: job.kind, answer: netOf(job.work, budget) };
    case 'links':
      return { kind: job.kind, answer: linksOf(job.work, budget) };
  }
}

export function completeFold<A>(work: FoldWork<A>, budget: Deadline): A {
  let step = work.next();
  while (!step.done) step = work.next(answerFold(step.value, budget));
  return step.value;
}
