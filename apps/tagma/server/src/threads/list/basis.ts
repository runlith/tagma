import { Effect } from 'effect';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ThreadLimitSubject, ThreadLimitTable } from '@runlith/agent/thread/compaction/limit';
import { CacheWarmth } from '../contract/service/evidence.js';
import { ContextLimits } from '../contract/service/limits.js';
import type { HarnessFailure } from '../contract/service/failure.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { WarmthBasis, WarmthSubject } from '../contract/wire/warmth.js';
import { restingThreads } from './warmth.js';

export type ThreadBasis = { readonly warmth: WarmthBasis; readonly limits: ThreadLimitTable };

export type BasisSubject = WarmthSubject & ThreadLimitSubject;

export type BasisServices = { readonly warmth: CacheWarmth['Service']; readonly limits: ContextLimits['Service'] };

export const NO_BASIS: ThreadBasis = { warmth: { curves: new Map(), accounts: new Map(), models: modelCatalog([]) }, limits: new Map() };

export type BasisThreads = { readonly all: readonly BasisSubject[]; readonly resting: readonly WarmthSubject[] };

export const rowThreads = (rows: readonly BasisSubject[]): BasisThreads => ({ all: rows, resting: rows });

export const stateThreads = (state: NativeThreadState, projectId: number): BasisThreads => ({
  all: [{ ...state.thread, projectId, activeRun: state.activeRun }],
  resting: restingThreads(state),
});

export function basisOf(services: BasisServices, threads: BasisThreads): Effect.Effect<ThreadBasis, HarnessFailure> {
  return Effect.map(
    Effect.all([services.warmth.warmthBasis(threads.resting), services.limits.of(threads.all)], { concurrency: 'unbounded' }),
    ([warmth, limits]) => ({ warmth, limits }),
  );
}

export const threadBasis = Effect.fnUntraced(function* (threads: BasisThreads) {
  return yield* basisOf({ warmth: yield* CacheWarmth, limits: yield* ContextLimits }, threads);
});

export function frameBasis(services: BasisServices, threads: BasisThreads): Effect.Effect<ThreadBasis> {
  const warmth = services.warmth
    .warmthBasis(threads.resting)
    .pipe(
      Effect.catch((failure) =>
        Effect.logWarning('a feed frame was wired without its warmth basis', failure).pipe(Effect.as(NO_BASIS.warmth)),
      ),
    );
  const limits = services.limits
    .of(threads.all)
    .pipe(
      Effect.catch((failure) =>
        Effect.logWarning('a feed frame was wired without its context limits', failure).pipe(Effect.as(NO_BASIS.limits)),
      ),
    );
  return Effect.map(Effect.all([warmth, limits], { concurrency: 'unbounded' }), ([basis, table]) => ({ warmth: basis, limits: table }));
}
