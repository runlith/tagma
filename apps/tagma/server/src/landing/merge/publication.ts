import { randomUUID } from 'node:crypto';
import { Clock, Effect, Exit } from 'effect';
import type { MergeGit, MergeSettled } from '../contract/service/mergeGit.js';
import type { HoldCut, HoldStalled, ReentrantCall } from '@runlith/held/failures';
import type { Lane } from '@runlith/held/Lane';

import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { FinishingGate } from '../../worktrees/contract/service/retirement.js';
import { type FinishFailure, WorktreeFinishRefused } from '../../worktrees/contract/wire/failures.js';
import type { Intent, IntentLifecycle } from '../store/intentLifecycle.js';
import type { MergeRequestRow, MergeRequests } from '../store/mergeRequests.js';
import { LandingLanes } from '../land/lanes.js';
import type { MergeTail } from './tail.js';

export type Publication = {
  readonly projectId: number;
  readonly checkout: string;
  readonly ref: string;
  readonly base: string;
  readonly tree: string;
  readonly commit: string;
  readonly job: string;
  readonly request: MergeRequestRow;
};

export type Settled = MergeSettled;

export type Sent =
  | { readonly _tag: 'moved' }
  | { readonly _tag: 'published'; readonly key: string; readonly settled: Settled; readonly unrecorded: string | null };

export type PublicationRecovery = {
  readonly published: readonly {
    readonly path: string;
    readonly commit: string;
    readonly unsynced: readonly string[];
    readonly reason: string | null;
  }[];
  readonly uncertain: readonly { readonly path: string; readonly commit: string; readonly rootId: string | null }[];
  readonly unread: readonly { readonly path: string; readonly reason: string }[];
};

export type Doubted = (request: MergeRequestRow, since: Date, reason: string) => Effect.Effect<void>;

type Resolved = { readonly _tag: 'published'; readonly settled: Settled } | { readonly _tag: 'uncertain'; readonly reason: string };

const MOVED: Sent = { _tag: 'moved' };

const PAGE = 64;

const KEPT = 7 * 24 * 60 * 60 * 1000;

const laneFailed = (failure: HoldStalled | HoldCut | ReentrantCall): Effect.Effect<never, HoldStalled | HoldCut> =>
  failure._tag === 'ReentrantCall' ? Effect.die(failure) : Effect.fail(failure);

const changedBy = Effect.fnUntraced(function* (git: MergeGit['Service'], checkout: string, base: string, commit: string) {
  const listed = yield* Effect.result(git.changed(checkout, base, commit));
  if (listed._tag === 'Success') return listed.success;
  yield* Effect.logWarning('the paths a merge changed could not be listed', { checkout, reason: listed.failure.message });
  return [];
});

export const mergePublications = (git: MergeGit['Service'], lifecycle: IntentLifecycle, requests: MergeRequests) => {
  const flying = new Set<string>();

  const during = <A, E, R>(request: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => flying.add(request)),
      () => work,
      () => Effect.sync(() => flying.delete(request)),
    );

  const noted = (step: string, work: Effect.Effect<unknown, StoreFailure>): Effect.Effect<string | null> =>
    Effect.map(Effect.result(work), (done) => (done._tag === 'Success' ? null : `${step}: ${done.failure.message}`));

  const unwitnessed = (key: string): Effect.Effect<void> =>
    Effect.flatMap(noted('the witness of a merge that published nothing stayed', lifecycle.forget(key)), (left) =>
      left === null ? Effect.void : Effect.logWarning(left, { key }),
    );

  const publish = Effect.fn('Merges.publish')(function* (publication: Publication) {
    const lanes = yield* LandingLanes;
    const { checkout, ref, base, commit } = publication;
    const key = `merge:${randomUUID()}`;
    return yield* lanes.commits
      .enter(
        checkout,
        Effect.gen(function* () {
          const operation = yield* git.operation(checkout);
          if (operation !== null) {
            return yield* new WorktreeFinishRefused({
              reason: 'base-mid-operation',
              message: `a ${operation} is in progress in ${checkout}, and a merge now would land beneath it`,
              unblock: ['end that operation in the base checkout, then merge'],
            });
          }
          const repository = yield* git.repository(checkout);
          const now = new Date(yield* Clock.currentTimeMillis);
          const intent: Intent = {
            key,
            kind: 'merge',
            projectId: publication.projectId,
            phase: 'publishing',
            repository,
            checkout,
            ref,
            base,
            tree: publication.tree,
            commit,
            witnessedAt: now,
            at: now,
          };
          yield* Effect.mapError(
            requests.intend(intent, publication.request),
            (failure) =>
              new WorktreeFinishRefused({
                reason: 'finishing-busy',
                message: `the merge could not be witnessed before it published, so nothing was published: ${failure.message}`,
                unblock: ['merge again'],
              }),
          );
          const sent = yield* git
            .advance({ checkout, ref, base, commit }, publication.job)
            .pipe(
              Effect.onExit((exit) =>
                Exit.hasFails(exit) && !Exit.hasInterrupts(exit) && !Exit.hasDies(exit) ? unwitnessed(key) : Effect.void,
              ),
            );
          if (!sent) {
            yield* unwitnessed(key);
            return MOVED;
          }
          const received = yield* noted(
            'the publication was not recorded',
            lifecycle.receive(key, commit, new Date(yield* Clock.currentTimeMillis)),
          );
          const settled = yield* git.settle({ checkout, ref, base, commit });
          return { _tag: 'published', key, settled, unrecorded: received } satisfies Sent;
        }),
      )
      .pipe(Effect.catchTags({ HoldStalled: laneFailed, HoldCut: laneFailed, ReentrantCall: laneFailed }));
  });

  const proved = (intent: Pick<Intent, 'repository' | 'checkout' | 'ref'>, commit: string) =>
    git.proved(intent.repository, intent.checkout, intent.ref, commit);

  const resolve = Effect.fnUntraced(function* (intent: Intent, commit: string): Effect.fn.Return<Resolved, FinishFailure | StoreFailure> {
    if (intent.phase === 'publishing') {
      if (!(yield* proved(intent, commit))) {
        return {
          _tag: 'uncertain',
          reason: `neither ${intent.ref} nor its reflog shows ${commit}, and a missing reflog entry does not prove the merge never published`,
        } as const;
      }
      yield* lifecycle.receive(intent.key, commit, new Date(yield* Clock.currentTimeMillis));
    }
    return {
      _tag: 'published',
      settled: yield* git.settle({ checkout: intent.checkout, ref: intent.ref, base: intent.base, commit }),
    } as const;
  });

  const recover = Effect.fn('Merges.recoverPublished')(function* (gate: FinishingGate['Service'], finish: MergeTail, doubted: Doubted) {
    const lanes = yield* LandingLanes;
    const published: PublicationRecovery['published'][number][] = [];
    const uncertain: PublicationRecovery['uncertain'][number][] = [];
    const unread: PublicationRecovery['unread'][number][] = [];
    let after: { readonly at: Date; readonly key: string } | null = null;
    for (;;) {
      const page: readonly Intent[] = yield* lifecycle.open('merge', after, PAGE);
      const asked = yield* requests.of(page.map((intent) => intent.key));
      for (const intent of page) {
        const request = asked.get(intent.key) ?? null;
        if (request !== null && flying.has(request.request)) continue;
        const commit = intent.commit;
        if (commit === null) {
          yield* lifecycle.forget(intent.key);
          continue;
        }
        const done = yield* Effect.result(
          gate.hold({ kind: 'checkout', path: intent.checkout }, lanes.commits.enter(intent.checkout, resolve(intent, commit))),
        );
        const resolved: Resolved | { readonly _tag: 'unread'; readonly reason: string } =
          done._tag === 'Failure' ? { _tag: 'unread', reason: done.failure.message } : done.success;
        if (resolved._tag !== 'published') {
          if (resolved._tag === 'unread') unread.push({ path: intent.checkout, reason: resolved.reason });
          else uncertain.push({ path: intent.checkout, commit, rootId: request?.rootId ?? null });
          if (request !== null) yield* doubted(request, intent.at, resolved.reason);
          continue;
        }
        const settled = resolved.settled;
        published.push({ path: intent.checkout, commit, ...settled });
        if (request === null) {
          yield* lifecycle.settle(intent.key);
          continue;
        }
        const paths = yield* changedBy(git, intent.checkout, intent.base, commit);
        const tail = yield* finish({
          projectId: intent.projectId,
          key: intent.key,
          request,
          checkout: intent.checkout,
          commit,
          from: intent.base,
          paths,
          asked: intent.at,
        });
        if (!tail.closed) unread.push({ path: intent.checkout, reason: tail.unrecorded.join('; ') });
        else if (tail.unrecorded.length > 0)
          yield* Effect.logWarning('a recovered merge was not fully recorded', { key: intent.key, unrecorded: tail.unrecorded });
      }
      const last: Intent | undefined = page.at(-1);
      if (last === undefined || page.length < PAGE) break;
      after = { at: last.at, key: last.key };
    }
    const cutoff = new Date((yield* Clock.currentTimeMillis) - KEPT);
    for (let gone = PAGE; gone >= PAGE;) gone = yield* lifecycle.prune('merge', cutoff, PAGE);
    return { published, uncertain, unread };
  });

  const holding = Effect.fnUntraced(function* (
    rootId: string,
  ): Effect.fn.Return<'tail' | 'uncertain' | null, StoreFailure | FinishFailure> {
    let held: 'tail' | 'uncertain' | null = null;
    for (const witness of yield* requests.tailOpen(rootId)) {
      if (witness.phase === 'published' || witness.commit === null) return 'tail';
      if (yield* proved({ repository: witness.repository, checkout: witness.checkout, ref: witness.ref }, witness.commit)) return 'tail';
      held = 'uncertain';
    }
    return held;
  });

  return { publish, during, recover, holding };
};

export type MergePublications = ReturnType<typeof mergePublications>;
